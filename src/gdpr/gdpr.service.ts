import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { In, LessThanOrEqual, Repository } from 'typeorm';
// See payments.service.ts for why this isn't `import Stripe from 'stripe'` — that
// form compiles but throws "stripe_1.default is not a constructor" at runtime with
// this project's esModuleInterop:false tsconfig.
import Stripe = require('stripe');
import { Env } from '../config/config.module';
import { User } from '../auth/entities/user.entity';
import { Resume } from '../resumes/entities/resume.entity';
import { ResumeVersion } from '../resume-versions/entities/resume-version.entity';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { Subscription } from '../payments/entities/subscription.entity';
import { AtsReport } from '../ats/entities/ats-report.entity';
import { AiSuggestion } from '../suggestions/entities/ai-suggestion.entity';
import { CoverLetter } from '../cover-letter/entities/cover-letter.entity';
import { InterviewQuestion } from '../interview/entities/interview-question.entity';
import { CompanyInsight } from '../company/entities/company-insight.entity';
import { SalaryEstimate } from '../salary/entities/salary-estimate.entity';
import { LearningRoadmap } from '../learning-roadmap/entities/learning-roadmap.entity';
import { GeneratedDocument } from '../documents/entities/generated-document.entity';
import { PipelineRun } from '../pipeline/entities/pipeline-run.entity';
import { PipelineStep } from '../pipeline/entities/pipeline-step.entity';
import { CreditLedger } from '../credits/entities/credit-ledger.entity';
import { TokenUsage } from '../ai/entities/token-usage.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { NotificationPreference } from '../notifications/entities/notification-preference.entity';
import { StorageService } from '../storage/storage.service';
import { IntegrationCallRecorderService } from '../integration-calls/integration-call-recorder.service';
import { attachStripeUsageTracking } from '../integration-calls/stripe-usage-tracking.util';

const PURGE_GRACE_DAYS = 30;
const STRIPE_API_VERSION = '2026-06-24.dahlia' as const;

@Injectable()
export class GdprService {
  private readonly logger = new Logger(GdprService.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly env: Env,
    @InjectQueue('gdpr') private readonly queue: Queue,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Resume) private readonly resumes: Repository<Resume>,
    @InjectRepository(ResumeVersion)
    private readonly resumeVersions: Repository<ResumeVersion>,
    @InjectRepository(Workspace)
    private readonly workspaces: Repository<Workspace>,
    @InjectRepository(Subscription)
    private readonly subscriptions: Repository<Subscription>,
    // AtsKeywordMatch is NOT injected here — it has a real FK to AtsReport
    // (onDelete:'CASCADE'), so deleting atsReports below cleans it up automatically.
    @InjectRepository(AtsReport)
    private readonly atsReports: Repository<AtsReport>,
    @InjectRepository(AiSuggestion)
    private readonly suggestions: Repository<AiSuggestion>,
    @InjectRepository(CoverLetter)
    private readonly coverLetters: Repository<CoverLetter>,
    @InjectRepository(InterviewQuestion)
    private readonly interviewQuestions: Repository<InterviewQuestion>,
    @InjectRepository(CompanyInsight)
    private readonly companyInsights: Repository<CompanyInsight>,
    @InjectRepository(SalaryEstimate)
    private readonly salaryEstimates: Repository<SalaryEstimate>,
    @InjectRepository(LearningRoadmap)
    private readonly roadmaps: Repository<LearningRoadmap>,
    @InjectRepository(GeneratedDocument)
    private readonly generatedDocuments: Repository<GeneratedDocument>,
    @InjectRepository(PipelineRun)
    private readonly runs: Repository<PipelineRun>,
    @InjectRepository(PipelineStep)
    private readonly steps: Repository<PipelineStep>,
    @InjectRepository(CreditLedger)
    private readonly creditLedger: Repository<CreditLedger>,
    @InjectRepository(TokenUsage)
    private readonly tokenUsage: Repository<TokenUsage>,
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    @InjectRepository(NotificationPreference)
    private readonly notificationPrefs: Repository<NotificationPreference>,
    private readonly storage: StorageService,
    private readonly integrationCalls: IntegrationCallRecorderService,
  ) {
    this.stripe = new Stripe(this.env.get('STRIPE_SECRET_KEY'), {
      apiVersion: STRIPE_API_VERSION,
    });
    attachStripeUsageTracking(this.stripe, this.integrationCalls);
  }

  /** Heavy data collection happens worker-side (GdprExportProcessor) — this just enqueues. */
  async requestExport(userId: string): Promise<void> {
    await this.queue.add('export', { userId });
  }

  /**
   * Hard-purges any account soft-deleted (UsersService.softDelete) more than 30 days
   * ago. Sprint 5-8 tables have NO foreign key to users/workspaces (plain uuid
   * columns, app-level ownership only — see those entities' own comments), so a bare
   * `DELETE FROM users` would silently leave every one of them orphaned. Everything
   * below is deleted explicitly, in dependency order, BEFORE the User row itself —
   * only then does the real FK cascade (Resume/JobDescription/Workspace/Profile/
   * RefreshToken/VerificationToken, all onDelete:'CASCADE') take care of the rest.
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purgeExpired(): Promise<{ purged: number }> {
    const cutoff = new Date(
      Date.now() - PURGE_GRACE_DAYS * 24 * 60 * 60 * 1000,
    );
    const due = await this.users.find({
      where: { status: 'deleted', deletedAt: LessThanOrEqual(cutoff) },
      withDeleted: true, // deletedAt IS the soft-delete marker — excluded by default
    });

    let purged = 0;
    for (const user of due) {
      try {
        await this.purgeOne(user.id);
        purged++;
      } catch (err) {
        this.logger.error(`purge failed for user ${user.id}`, err as Error);
      }
    }
    return { purged };
  }

  private async purgeOne(userId: string): Promise<void> {
    const workspaceIds = (
      await this.workspaces.find({
        where: { userId },
        select: { id: true },
        withDeleted: true,
      })
    ).map((w) => w.id);

    // resume_versions has no real FK to resumes (plain uuid column, like every other
    // Sprint 5+ table) — ResumeSection cascades fine via a real FK, but this one
    // would survive the user's Resume rows cascading away unless deleted explicitly.
    const resumeIds = (
      await this.resumes.find({
        where: { userId },
        select: { id: true },
        withDeleted: true,
      })
    ).map((r) => r.id);
    if (resumeIds.length) {
      await this.resumeVersions.delete({ resumeId: In(resumeIds) });
    }

    const sub = await this.subscriptions.findOne({ where: { userId } });
    if (sub?.stripeSubscriptionId) {
      try {
        await this.stripe.subscriptions.cancel(sub.stripeSubscriptionId);
      } catch (err) {
        // Already canceled, or Stripe is unreachable — must not block the purge on a
        // third party being unavailable; the local rows are the source of truth for
        // GDPR compliance, not Stripe's.
        this.logger.warn(
          `stripe cancel failed for user ${userId} (continuing purge): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    if (workspaceIds.length) {
      const runIds = (
        await this.runs.find({
          where: { workspaceId: In(workspaceIds) },
          select: { id: true },
        })
      ).map((r) => r.id);
      if (runIds.length) await this.steps.delete({ runId: In(runIds) });
      await this.runs.delete({ workspaceId: In(workspaceIds) });

      await this.atsReports.delete({ workspaceId: In(workspaceIds) });
      await this.suggestions.delete({ workspaceId: In(workspaceIds) });
      await this.coverLetters.delete({ workspaceId: In(workspaceIds) });
      await this.interviewQuestions.delete({ workspaceId: In(workspaceIds) });
      await this.companyInsights.delete({ workspaceId: In(workspaceIds) });
      await this.salaryEstimates.delete({ workspaceId: In(workspaceIds) });
      await this.roadmaps.delete({ workspaceId: In(workspaceIds) });
      await this.generatedDocuments.delete({ workspaceId: In(workspaceIds) });
    }

    await this.creditLedger.delete({ userId });
    await this.tokenUsage.delete({ userId });
    await this.notifications.delete({ userId });
    await this.notificationPrefs.delete({ userId });
    await this.subscriptions.delete({ userId });

    // Deliberately NOT deleted: audit_logs. It's a compliance record of what
    // happened, not personal data the user submitted — kept with userId still
    // attached since AuditLog.userId is nullable/loose (no FK) precisely so it can
    // outlive the user row it refers to (see that entity's own comment).

    // Both resume originals (users/{id}/resumes/...) and generated documents
    // (users/{id}/workspaces/...) live under this one prefix.
    await this.storage.deletePrefix(`users/${userId}/`);

    // Hard delete, NOT softDelete — this is the actual purge. Cascades (CASCADE FKs)
    // clean up refresh_tokens, verification_tokens, profiles, resumes (->
    // resume_sections, resume_versions), job_descriptions, and workspaces themselves.
    await this.users.delete(userId);
  }
}
