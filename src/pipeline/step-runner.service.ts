import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PipelineRun, RunStatus } from './entities/pipeline-run.entity';
// Aliased: the DB row and the step-contract abstract class are both legitimately named
// "PipelineStep" (one per the pipeline_steps table, one per the doc's step interface) —
// this is the only file that needs both, so only here does the collision need resolving.
import {
  PipelineStep as PipelineStepRow,
  StepStatus,
} from './entities/pipeline-step.entity';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { StepRegistry } from './steps/step.registry';
import { PipelineContext, PipelineStep } from './steps/step.interface';
import { ProgressBus } from './progress/progress.bus';
import { ContextHydrator } from './context-hydrator.service';
import { CreditService } from '../credits/credit.service';
import { AppException } from '../common/exceptions/app.exception';

// One step-level retry attempt is warranted for a transient provider outage — this is
// distinct from (and on top of) AiService's own internal retries: this layer retries
// the WHOLE step, including any DB writes after the AI call, not just the HTTP call.
const RETRYABLE_CODES = new Set(['AI_PROVIDER_UNAVAILABLE']);
const MAX_STEP_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class StepRunner {
  private readonly logger = new Logger(StepRunner.name);

  constructor(
    @InjectRepository(PipelineRun)
    private readonly runs: Repository<PipelineRun>,
    @InjectRepository(PipelineStepRow)
    private readonly stepRows: Repository<PipelineStepRow>,
    @InjectRepository(Workspace)
    private readonly workspaces: Repository<Workspace>,
    private readonly registry: StepRegistry,
    private readonly bus: ProgressBus,
    private readonly credits: CreditService,
    private readonly hydrator: ContextHydrator,
  ) {}

  async execute(runId: string): Promise<void> {
    const run = await this.runs.findOneOrFail({ where: { id: runId } });

    // A retried BullMQ job re-enters here. Completed steps are skipped below, so this
    // is safe — but a run already finished must not restart.
    if (run.status === 'completed') return;

    await this.runs.update(runId, {
      status: 'running',
      startedAt: run.startedAt ?? new Date(),
    });
    await this.workspaces.update(run.workspaceId, { status: 'processing' });

    const ctx = await this.hydrator.hydrate(run);
    const steps = this.registry.all();
    this.bus.publish(runId, {
      type: 'run.started',
      runId,
      stepsTotal: steps.length,
    });

    // p-limit is ESM-only; dynamic import avoids relying on Node 22's require(esm)
    // interop, matching the same reasoning as AiService.
    const { default: pLimit } = await import('p-limit');
    const limit = pLimit(3);

    const done = new Set<string>();
    const failed = new Set<string>();

    // Load already-completed steps from a previous attempt — this is what makes a
    // worker crash recoverable instead of a full restart.
    const prior = await this.stepRows.find({ where: { runId } });
    for (const p of prior) {
      if (p.status === 'completed' || p.status === 'skipped') done.add(p.name);
    }

    // ── DAG execution, wave by wave ──
    // Steps whose dependencies are satisfied run in parallel.
    while (done.size + failed.size < steps.length) {
      const ready = steps.filter(
        (s) =>
          !done.has(s.name) &&
          !failed.has(s.name) &&
          s.dependsOn.every((d) => done.has(d)),
      );

      if (!ready.length) {
        // Everything left is blocked by a failed dependency. Mark them skipped rather
        // than leaving the run hanging forever.
        for (const s of steps) {
          if (!done.has(s.name) && !failed.has(s.name)) {
            await this.markStep(runId, s.name, 'skipped', {
              error: 'dependency failed',
            });
            failed.add(s.name);
          }
        }
        break;
      }

      const results = await Promise.all(
        ready.map((step) => limit(() => this.runStep(run, step, ctx))),
      );

      results.forEach((ok, i) => (ok ? done : failed).add(ready[i].name));
    }

    await this.finalise(runId, failed);
  }

  private async runStep(
    run: PipelineRun,
    step: PipelineStep,
    ctx: PipelineContext,
  ): Promise<boolean> {
    // ── IDEMPOTENCE: never re-run a completed step. Rule #1 of the orchestrator.
    // Without it, a BullMQ retry after step 5 re-runs steps 1-4 and re-charges for
    // every one of them.
    const existing = await this.stepRows.findOne({
      where: { runId: run.id, name: step.name },
    });
    if (existing?.status === 'completed') {
      return true;
    }

    const skipReason = await step.shouldSkip(ctx);
    if (skipReason) {
      await this.markStep(run.id, step.name, 'skipped');
      this.bus.publish(run.id, {
        type: 'step.skipped',
        runId: run.id,
        step: step.name,
        progress: await this.progress(run.id),
        reason: skipReason,
      });
      return true;
    }

    await this.markStep(run.id, step.name, 'running');
    await this.runs.update(run.id, { currentStep: step.name });
    this.bus.publish(run.id, {
      type: 'step.started',
      runId: run.id,
      step: step.name,
      label: step.label,
      progress: await this.progress(run.id),
    });

    for (let attempt = 1; attempt <= MAX_STEP_ATTEMPTS; attempt++) {
      try {
        const result = await step.run(ctx);

        await this.markStep(run.id, step.name, 'completed', {
          attempt,
          outputRef: result.outputRef,
        });
        this.bus.publish(run.id, {
          type: 'step.completed',
          runId: run.id,
          step: step.name,
          progress: await this.progress(run.id),
          payload: result.preview,
        });
        return true;
      } catch (err) {
        const code = err instanceof AppException ? err.code : undefined;
        const retryable = code ? RETRYABLE_CODES.has(code) : false;
        const willRetry = retryable && attempt < MAX_STEP_ATTEMPTS;

        this.logger.warn(
          `step "${step.name}" failed (attempt ${attempt}/${MAX_STEP_ATTEMPTS}, willRetry=${willRetry}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        this.bus.publish(run.id, {
          type: 'step.failed',
          runId: run.id,
          step: step.name,
          willRetry,
          attempt,
        });

        if (!willRetry) {
          await this.markStep(run.id, step.name, 'failed', {
            attempt,
            error: err instanceof Error ? err.message : String(err),
            errorType: code ?? 'unknown',
          });
          return false;
        }
        await sleep(1000 * 2 ** (attempt - 1) + Math.random() * 300);
      }
    }
    return false;
  }

  /** Weighted progress — a 25-weight step moves the bar five times as far as a 5-weight one. */
  private async progress(runId: string): Promise<number> {
    const rows = await this.stepRows.find({ where: { runId } });
    const total = rows
      .filter((r) => r.status === 'completed' || r.status === 'skipped')
      .reduce(
        (n, r) => n + (this.registry.get(r.name)?.progressWeight ?? 0),
        0,
      );
    await this.runs.update(runId, {
      progress: total,
      stepsCompleted: rows.length,
    });
    return Math.min(100, total);
  }

  private async finalise(runId: string, failed: Set<string>) {
    const run = await this.runs.findOneOrFail({ where: { id: runId } });
    const failedRequired = [...failed].filter(
      (n) => this.registry.get(n)?.required,
    );

    let status: RunStatus;
    if (failed.size === 0) status = 'completed';
    else if (failedRequired.length) status = 'failed';
    else status = 'partial'; // only optional steps failed

    // ── Proportional refund ──
    // The user paid for a full analysis. Refund the credit weight of everything that
    // did NOT produce an artifact. Refunding nothing on failure invites chargebacks;
    // refunding everything means a run that produced 90% of the value is free.
    let refunded = 0;
    if (status !== 'completed' && run.creditsCharged > 0) {
      const lostWeight = [...failed].reduce(
        (n, name) => n + (this.registry.get(name)?.creditWeight ?? 0),
        0,
      );
      const totalWeight = this.registry
        .all()
        .reduce((n, s) => n + s.creditWeight, 0);
      refunded = Math.round(run.creditsCharged * (lostWeight / totalWeight));
      if (refunded > 0) {
        await this.credits.refund(run.userId, refunded, 'refund', run.id);
      }
    }

    const cost = await this.stepRows
      .createQueryBuilder('s')
      .select('COALESCE(SUM(s.costUsd), 0)', 'c')
      .where('s.runId = :runId', { runId })
      .getRawOne<{ c: string }>();

    await this.runs.update(runId, {
      status,
      finishedAt: new Date(),
      progress: status === 'completed' ? 100 : run.progress,
      failedSteps: [...failed],
      creditsRefunded: refunded,
      totalCostUsd: cost?.c ?? '0',
      currentStep: null,
    });
    await this.workspaces.update(run.workspaceId, {
      status: status as Workspace['status'],
      lastRunId: runId,
    });

    const durationMs = Date.now() - (run.startedAt?.getTime() ?? Date.now());
    this.bus.publish(
      runId,
      status === 'completed'
        ? { type: 'run.completed', runId, progress: 100, durationMs }
        : {
            type: 'run.failed',
            runId,
            status: status as 'failed' | 'partial',
            failedSteps: [...failed],
            refundedCredits: refunded,
          },
    );
  }

  private async markStep(
    runId: string,
    name: string,
    status: StepStatus,
    extra: Partial<PipelineStepRow> = {},
  ) {
    await this.stepRows.upsert(
      {
        runId,
        name,
        status,
        ...(status === 'running' && { startedAt: new Date() }),
        ...((status === 'completed' ||
          status === 'failed' ||
          status === 'skipped') && {
          finishedAt: new Date(),
        }),
        ...extra,
      },
      { conflictPaths: ['runId', 'name'] },
    );
  }
}
