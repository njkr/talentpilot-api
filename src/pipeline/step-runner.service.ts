import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
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
import { AppException, ErrorCode } from '../common/exceptions/app.exception';
import { TokenUsage } from '../ai/entities/token-usage.entity';

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
    @InjectRepository(TokenUsage)
    private readonly tokenUsage: Repository<TokenUsage>,
    private readonly registry: StepRegistry,
    private readonly bus: ProgressBus,
    private readonly credits: CreditService,
    private readonly hydrator: ContextHydrator,
    private readonly eventEmitter: EventEmitter2,
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
    //
    // A prior 'skipped' row is only treated as resolved if it was a GENUINE skip
    // (step.shouldSkip() said so). The "everything left is blocked" branch below also
    // persists status 'skipped' (with error: 'dependency failed') for steps that never
    // got a chance to run at all — e.g. finalize, blocked because generate_cover_letter
    // failed on attempt 1. Counting that as permanently resolved meant a retry that
    // fixed the blocking step (attempt 2, cover letter now succeeds) would STILL never
    // re-attempt finalize: it was already "done" as far as this loader was concerned,
    // so the run reported status 'completed' while finalize silently never ran and its
    // consolidated summary was never produced.
    const prior = await this.stepRows.find({ where: { runId } });
    for (const p of prior) {
      if (p.status === 'completed') done.add(p.name);
      if (p.status === 'skipped' && p.error !== 'dependency failed')
        done.add(p.name);
    }

    // A dependency counts as "resolved" (safe to proceed past) if it either completed,
    // or failed but was OPTIONAL — an optional step's failure must not permanently
    // block everything downstream of it. This matters most for `finalize`, which
    // depends on every other step including the optional ones (research_company,
    // estimate_salary): without this, one dead Tavily key would cascade into blocking
    // `finalize` itself, turning what should be a `partial` run into a hard `failed`
    // one — defeating the entire point of marking those steps optional.
    const dependencyResolved = (name: string) =>
      done.has(name) ||
      (failed.has(name) && !this.registry.get(name)?.required);

    // ── DAG execution, wave by wave ──
    // Steps whose dependencies are satisfied run in parallel.
    while (done.size + failed.size < steps.length) {
      const ready = steps.filter(
        (s) =>
          !done.has(s.name) &&
          !failed.has(s.name) &&
          s.dependsOn.every(dependencyResolved),
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
      await this.markStep(run.id, step.name, 'skipped', {
        error: null,
        errorType: null,
      });
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
          costUsd: await this.stepCost(run.id, step.name),
          // upsert() only writes the columns given here — a retry that succeeds on a
          // step which failed on a prior attempt would otherwise leave that attempt's
          // error/errorType text sitting on an otherwise-'completed' row forever.
          error: null,
          errorType: null,
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
            // A step can fail AFTER making one or more real (billed) AI calls — e.g.
            // the optimiser generates suggestions, then a later save fails. That
            // spend actually happened and belongs in the run's total, not silently
            // dropped because the step itself didn't finish.
            costUsd: await this.stepCost(run.id, step.name),
          });
          return false;
        }
        await sleep(1000 * 2 ** (attempt - 1) + Math.random() * 300);
      }
    }
    return false;
  }

  /**
   * Real spend for one step, summed from token_usage — every AiService.complete()/
   * embed() call already tags its usage row with (runId, stepName), so this is exact,
   * not estimated. A step attempt that made zero AI calls (e.g. a pure-DB step, or one
   * that failed before ever calling out) correctly sums to 0.
   */
  private async stepCost(runId: string, name: string): Promise<string> {
    const row = await this.tokenUsage
      .createQueryBuilder('u')
      .select('COALESCE(SUM(u.costUsd), 0)', 'c')
      .where('u.runId = :runId AND u.stepName = :name', { runId, name })
      .getRawOne<{ c: string }>();
    return row?.c ?? '0';
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
    let creditsRefunded = run.creditsRefunded ?? 0;
    let refundedSteps = run.refundedSteps ?? [];
    if (status !== 'completed' && run.creditsCharged > 0) {
      // Refund ONLY steps that have never been refunded before on this run. A step
      // that fails identically on every retry (a deterministic failure — e.g. this
      // JD genuinely has no company name, so generate_cover_letter will keep failing
      // the same way every time) must be refunded exactly ONCE, not once per retry.
      // Without this guard, retrying a permanently-broken run manufactures credits:
      // the same failed weight was being re-refunded and added to the running total
      // on every single attempt, with nothing capping it at creditsCharged.
      const alreadyRefunded = new Set(refundedSteps);
      const newlyFailed = [...failed].filter(
        (name) => !alreadyRefunded.has(name),
      );
      const lostWeight = newlyFailed.reduce(
        (n, name) => n + (this.registry.get(name)?.creditWeight ?? 0),
        0,
      );
      const totalWeight = this.registry
        .all()
        .reduce((n, s) => n + s.creditWeight, 0);
      refunded = Math.round(run.creditsCharged * (lostWeight / totalWeight));
      if (refunded > 0) {
        await this.credits.refund(run.userId, refunded, 'refund', run.id);
        // Cumulative across every attempt of this run, NOT overwritten — a retry
        // that fails a DIFFERENT step than the first attempt must not lose track of
        // the earlier refund (see reverseRefund() below, which relies on this being
        // the true lifetime total for the run, not just this round's amount). Hard
        // capped at creditsCharged as a last-resort invariant: a refund can never
        // exceed what was actually charged, no matter what the proportional math
        // above computes.
        creditsRefunded = Math.min(
          run.creditsCharged,
          (run.creditsRefunded ?? 0) + refunded,
        );
        refundedSteps = [...refundedSteps, ...newlyFailed];
      }
    } else if (status === 'completed' && (run.creditsRefunded ?? 0) > 0) {
      // ── Reversal ──
      // A previous attempt on this exact run was proportionally refunded, then a
      // retry went on to deliver the COMPLETE product. Without this, the user paid
      // creditsCharged - creditsRefunded for something that cost the full
      // creditsCharged — a real, ongoing revenue leak, not a cosmetic one.
      await this.reverseRefund(run.userId, run.creditsRefunded ?? 0, run.id);
      creditsRefunded = 0;
      refundedSteps = [];
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
      creditsRefunded,
      refundedSteps,
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

    // Separate from ProgressBus above: that's Redis pub/sub for live SSE progress
    // (ephemeral, only reaches an open connection). This is an in-process domain event
    // for anything that needs to react to run completion durably — right now,
    // PipelineNotificationListener, which writes an in-app + email notification even if
    // the user has no SSE connection open (e.g. they closed the tab and came back later).
    this.eventEmitter.emit(
      status === 'completed' ? 'run.completed' : 'run.failed',
      {
        runId,
        userId: run.userId,
        workspaceId: run.workspaceId,
        status,
        failedSteps: [...failed],
      },
    );
  }

  /**
   * Reverses an earlier proportional refund once a retry on the same run has gone on
   * to deliver the complete product. Tries a normal debit first; if the user's
   * balance is no longer sufficient to "afford" it (they may have spent the refund
   * elsewhere), forces it through anyway via a negative grant rather than silently
   * skipping the reversal — the analysis was genuinely delivered in full, and letting
   * the balance go negative is the correct outcome here, not leaving the run
   * permanently under-billed.
   */
  private async reverseRefund(
    userId: string,
    amount: number,
    runId: string,
  ): Promise<void> {
    try {
      await this.credits.debit(userId, amount, 'retry_reversal', runId);
    } catch (err) {
      if (
        err instanceof AppException &&
        err.code === ErrorCode.INSUFFICIENT_CREDITS
      ) {
        await this.credits.grant(userId, -amount, 'retry_reversal', runId);
        this.logger.warn(
          `refund reversal for run ${runId} drove user ${userId}'s balance negative`,
        );
      } else {
        throw err;
      }
    }
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
