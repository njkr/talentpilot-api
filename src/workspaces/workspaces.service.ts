import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DataSource, In, Repository } from 'typeorm';
import { Workspace } from './entities/workspace.entity';
import { PipelineRun } from '../pipeline/entities/pipeline-run.entity';
import { PipelineStep } from '../pipeline/entities/pipeline-step.entity';
import { STEP_COUNT } from '../pipeline/steps/step-manifest';
import { ResumesService } from '../resumes/resumes.service';
import { JobDescriptionsService } from '../job-descriptions/job-descriptions.service';
import { CreditService } from '../credits/credit.service';
import { PaymentConfigService } from '../payments/config/payment-config.service';
import { PlanLimitService } from '../subscriptions/plan-limit.service';
import { Problems } from '../common/problems';
import { CursorQueryDto } from '../common/dto/cursor-query.dto';
import { decodeCursor, encodeCursor } from '../common/utils/cursor.util';
import { AtsReport } from '../ats/entities/ats-report.entity';
import { AtsKeywordMatch } from '../ats/entities/ats-keyword-match.entity';

// Historically a hardcoded 21 (sum of every step's creditWeight in STEP_MANIFEST,
// Sprints 5-8) — now admin-editable via PaymentConfig.analyzeCost (Sprint 13; see
// PaymentConfigService.get()). Not required to equal STEP_MANIFEST's total weight:
// StepRunner.finalise()'s proportional refund computes its own totalWeight
// independently, so the refund math stays correct at any charged amount.
//
// Deliberately a FLAT fee, charged once regardless of how many steps a retry
// ultimately skips (e.g. re-analysing an unchanged resume/JD pair skips
// parse_resume/parse_jd, weight 3 of 21, but is still charged the full amount). This
// is an intentional policy, not a bug: "analyze" is priced as one action, and a
// partial discount for internal step reuse would need its own product decision (a
// skipped step isn't "refunded work" the way a genuinely FAILED step is — see
// StepRunner.finalise()'s proportional refund, which only ever applies to failures).
const ONE_ACTIVE_RUN_CONSTRAINT = 'one_active_run_per_workspace';

@Injectable()
export class WorkspacesService {
  constructor(
    @InjectRepository(Workspace)
    private readonly workspaces: Repository<Workspace>,
    @InjectRepository(PipelineRun)
    private readonly runs: Repository<PipelineRun>,
    @InjectRepository(PipelineStep)
    private readonly stepRows: Repository<PipelineStep>,
    @InjectRepository(AtsReport)
    private readonly atsReports: Repository<AtsReport>,
    @InjectRepository(AtsKeywordMatch)
    private readonly keywordMatches: Repository<AtsKeywordMatch>,
    @InjectQueue('pipeline') private readonly queue: Queue,
    private readonly resumesService: ResumesService,
    private readonly jdsService: JobDescriptionsService,
    private readonly credits: CreditService,
    private readonly planLimits: PlanLimitService,
    private readonly paymentConfig: PaymentConfigService,
    private readonly dataSource: DataSource,
  ) {}

  async create(
    userId: string,
    resumeId: string,
    jobDescriptionId: string,
    name: string,
  ) {
    await this.planLimits.assertCanCreateWorkspace(userId);

    // Ownership check on both sides — a foreign resume/JD id 404s here rather than
    // surfacing as a confusing FK violation on insert.
    await this.resumesService.findOwned(resumeId, userId);
    await this.jdsService.findOwned(jobDescriptionId, userId);

    return this.workspaces.save(
      this.workspaces.create({
        userId,
        resumeId,
        jobDescriptionId,
        name,
        status: 'created',
      }),
    );
  }

  async list(userId: string, q: CursorQueryDto) {
    const after = decodeCursor(q.cursor);
    const qb = this.workspaces
      .createQueryBuilder('w')
      .where('w.user_id = :userId', { userId })
      .orderBy('w.created_at', 'DESC')
      .addOrderBy('w.id', 'DESC')
      .take(q.limit + 1);
    if (after) {
      qb.andWhere('(w.created_at, w.id) < (:c, :i)', {
        c: after.createdAt,
        i: after.id,
      });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > q.limit;
    const data = hasMore ? rows.slice(0, q.limit) : rows;
    return {
      data,
      hasMore,
      nextCursor: hasMore ? encodeCursor(data.at(-1)!) : null,
    };
  }

  /** Ownership via scoped WHERE, not fetch-then-compare — a foreign id 404s, never 403. */
  async findOwned(id: string, userId: string): Promise<Workspace> {
    const ws = await this.workspaces.findOne({ where: { id, userId } });
    if (!ws) throw new NotFoundException();
    return ws;
  }

  async remove(id: string, userId: string): Promise<void> {
    await this.findOwned(id, userId);
    await this.workspaces.softDelete(id);
  }

  async analyze(workspaceId: string, userId: string, idempotencyKey?: string) {
    if (!idempotencyKey) throw Problems.idempotencyKeyRequired();

    const ws = await this.workspaces.findOne({
      where: { id: workspaceId, userId },
      relations: { resume: true, jobDescription: true },
    });
    if (!ws) throw new NotFoundException();

    // Replaying the same key returns the existing run — the client asked for "this
    // analysis" and it already exists, so 200/202 not 409.
    const existing = await this.runs.findOne({ where: { idempotencyKey } });
    if (existing) return { run: existing, replayed: true };

    if (ws.resume.status !== 'parsed') {
      throw Problems.resumeNotReady(ws.resume.status);
    }
    if (ws.jobDescription.status !== 'analyzed') {
      throw Problems.jdNotReady(ws.jobDescription.status);
    }

    const analyzeCost = (await this.paymentConfig.get()).analyzeCost;
    const balance = await this.credits.balance(userId);
    if (balance < analyzeCost) {
      throw Problems.insufficientCredits(analyzeCost, balance);
    }

    // ── Run creation + credit debit in ONE transaction ──
    // If the debit fails after the run is committed, the partial unique index blocks
    // every future analysis for this workspace forever. If the run fails after the
    // debit, the user paid for nothing. Both must land together or neither.
    let run: PipelineRun;
    try {
      run = await this.dataSource.transaction(async (m) => {
        const created = await m.save(
          PipelineRun,
          m.create(PipelineRun, {
            workspaceId,
            userId,
            idempotencyKey,
            status: 'queued',
            trigger: 'full_analyze',
            stepsTotal: STEP_COUNT,
            creditsCharged: analyzeCost,
            resumeVersion: ws.resume.currentVersion,
          }),
        );
        await this.credits.debitWithin(
          m,
          userId,
          analyzeCost,
          'analyze',
          created.id,
        );
        return created;
      });
    } catch (e: unknown) {
      // 23505 on the partial unique index = another run is already active.
      const pgErr = e as { code?: string; constraint?: string };
      if (
        pgErr?.code === '23505' &&
        pgErr?.constraint === ONE_ACTIVE_RUN_CONSTRAINT
      ) {
        const active = await this.runs.findOne({
          where: { workspaceId, status: In(['queued', 'running']) },
        });
        throw Problems.analysisAlreadyRunning(active!.id);
      }
      throw e;
    }

    await this.workspaces.update(workspaceId, {
      status: 'queued',
      lastRunId: run.id,
      analyzedResumeVersion: ws.resume.currentVersion,
    });

    // ── Enqueue AFTER the transaction commits ──
    // Inside the transaction, the worker could pick up the job before the run row is
    // visible and fail with "run not found".
    await this.queue.add(
      'full-analyze',
      { runId: run.id },
      {
        jobId: run.id, // BullMQ-level dedupe as a second net
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: false, // failed jobs are forensic evidence
      },
    );

    return { run, replayed: false };
  }

  async retry(runId: string, userId: string) {
    const run = await this.runs.findOne({ where: { id: runId, userId } });
    if (!run) throw new NotFoundException();
    if (!['failed', 'partial'].includes(run.status)) {
      throw Problems.runNotRetryable(run.status);
    }
    // No re-charge: completed steps are skipped by StepRunner, so the user only gets
    // the work they already paid for re-run.
    await this.runs.update(runId, {
      status: 'queued',
      error: null,
      finishedAt: null,
    });
    await this.queue.add(
      'full-analyze',
      { runId },
      { jobId: `${runId}:retry:${Date.now()}` },
    );
    return this.runs.findOneOrFail({ where: { id: runId } });
  }

  /** Poll-fallback + SSE-snapshot data source — same shape either way. */
  async getRun(
    runId: string,
    userId: string,
  ): Promise<{ run: PipelineRun; steps: PipelineStep[] }> {
    const run = await this.runs.findOne({ where: { id: runId, userId } });
    if (!run) throw new NotFoundException();
    const steps = await this.stepRows.find({ where: { runId } });
    return { run, steps };
  }

  /**
   * The score itself — most recent AtsReport for this workspace, i.e. the output of
   * its most recent `score_ats` step. A `partial` run can still have a report if
   * `score_ats` was the step that succeeded and something else failed downstream of
   * it in a future pipeline; today `score_ats` has no dependents, so `partial` here
   * only happens when `score_ats` itself is the one that failed — in which case no
   * report exists and we fall through to the same REPORT_NOT_READY as `queued`.
   */
  async getReport(
    workspaceId: string,
    userId: string,
  ): Promise<{ report: AtsReport; keywords: AtsKeywordMatch[] }> {
    const ws = await this.findOwned(workspaceId, userId);
    const report = await this.atsReports.findOne({
      where: { workspaceId },
      order: { createdAt: 'DESC' },
    });
    if (!report) throw Problems.reportNotReady(ws.status);
    const keywords = await this.keywordMatches.find({
      where: { atsReportId: report.id },
    });
    return { report, keywords };
  }
}
