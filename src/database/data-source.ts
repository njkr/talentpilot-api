import 'dotenv/config';
import { DataSource, DataSourceOptions } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { Profile } from '../profiles/entities/profile.entity';
import { Resume } from '../resumes/entities/resume.entity';
import { ResumeSection } from '../resumes/entities/resume-section.entity';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { PromptTemplate } from '../prompts/entities/prompt-template.entity';
import { TokenUsage } from '../ai/entities/token-usage.entity';
import { JobDescription } from '../job-descriptions/entities/job-description.entity';
import { Embedding } from '../embeddings/entities/embedding.entity';
import { CreditLedger } from '../credits/entities/credit-ledger.entity';
import { PipelineRun } from '../pipeline/entities/pipeline-run.entity';
import { PipelineStep } from '../pipeline/entities/pipeline-step.entity';
import { AtsReport } from '../ats/entities/ats-report.entity';
import { AtsKeywordMatch } from '../ats/entities/ats-keyword-match.entity';
import { AiSuggestion } from '../suggestions/entities/ai-suggestion.entity';
import { ResumeVersion } from '../resume-versions/entities/resume-version.entity';
import { CoverLetter } from '../cover-letter/entities/cover-letter.entity';
import { InterviewQuestion } from '../interview/entities/interview-question.entity';
import { LearningRoadmap } from '../learning-roadmap/entities/learning-roadmap.entity';
import { CompanyResearchCache } from '../company/entities/company-research-cache.entity';
import { CompanyInsight } from '../company/entities/company-insight.entity';
import { SalaryEstimate } from '../salary/entities/salary-estimate.entity';
import { GeneratedDocument } from '../documents/entities/generated-document.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { NotificationPreference } from '../notifications/entities/notification-preference.entity';
import { Plan } from '../payments/entities/plan.entity';
import { Subscription } from '../payments/entities/subscription.entity';
import { WebhookEvent } from '../payments/entities/webhook-event.entity';
import { PaymentConfig } from '../payments/entities/payment-config.entity';
import { CreditPack } from '../payments/entities/credit-pack.entity';
import { Referral } from '../referrals/entities/referral.entity';
import { IntegrationCall } from '../integration-calls/entities/integration-call.entity';
import { AffiliateLink } from '../affiliate-links/entities/affiliate-link.entity';

// Single source of truth for the DB connection, shared by:
//  - the Nest app (via TypeOrmModule.forRootAsync in app.module.ts)
//  - the TypeORM CLI (migration:generate / migration:run / migration:revert)
// The CLI has no Nest DI container, so this reads process.env directly
// (via dotenv/config) rather than through the Env service.

// Managed Postgres (Neon, RDS, etc.) requires TLS and presents a cert not in Node's
// default trust store — rejectUnauthorized:false skips CA verification (fine here:
// the connection is still encrypted, and DATABASE_URL itself is the actual secret
// boundary). Local docker-compose Postgres has no TLS listener at all, so this must
// stay off unless DATABASE_URL actually points at one. DATABASE_SSL overrides the
// NODE_ENV-based default independent of COOKIE_CROSS_SITE (see env.schema.ts) — e.g.
// a local backend with a local DB can still need cross-site cookies without needing DB
// TLS, and vice versa.
const useDatabaseSsl = process.env.DATABASE_SSL
  ? process.env.DATABASE_SSL === 'true'
  : process.env.NODE_ENV === 'production';

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: process.env.DATABASE_URL,
  poolSize: process.env.DB_POOL_SIZE ? Number(process.env.DB_POOL_SIZE) : 10,
  ssl: useDatabaseSsl ? { rejectUnauthorized: false } : false,
  entities: [
    User,
    RefreshToken,
    VerificationToken,
    AuditLog,
    Profile,
    Resume,
    ResumeSection,
    Workspace,
    PromptTemplate,
    TokenUsage,
    JobDescription,
    Embedding,
    CreditLedger,
    PipelineRun,
    PipelineStep,
    AtsReport,
    AtsKeywordMatch,
    AiSuggestion,
    ResumeVersion,
    CoverLetter,
    InterviewQuestion,
    LearningRoadmap,
    CompanyResearchCache,
    CompanyInsight,
    SalaryEstimate,
    GeneratedDocument,
    Notification,
    NotificationPreference,
    Plan,
    Subscription,
    WebhookEvent,
    PaymentConfig,
    CreditPack,
    Referral,
    IntegrationCall,
    AffiliateLink,
  ],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  synchronize: false, // migrations only — see Sprint 1 §2
  logging: process.env.NODE_ENV === 'development',
};

// The CLI needs an actual DataSource instance (not just options).
export default new DataSource(dataSourceOptions);
