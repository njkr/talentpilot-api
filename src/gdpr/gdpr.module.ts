import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/entities/user.entity';
import { Resume } from '../resumes/entities/resume.entity';
import { ResumeVersion } from '../resume-versions/entities/resume-version.entity';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { Subscription } from '../payments/entities/subscription.entity';
import { AtsReport } from '../ats/entities/ats-report.entity';
import { AtsKeywordMatch } from '../ats/entities/ats-keyword-match.entity';
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
import { StorageModule } from '../storage/storage.module';
import { IntegrationCallsModule } from '../integration-calls/integration-calls.module';
import { GdprService } from './gdpr.service';
import { GdprController } from './gdpr.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Resume,
      ResumeVersion,
      Workspace,
      Subscription,
      AtsReport,
      AtsKeywordMatch,
      AiSuggestion,
      CoverLetter,
      InterviewQuestion,
      CompanyInsight,
      SalaryEstimate,
      LearningRoadmap,
      GeneratedDocument,
      PipelineRun,
      PipelineStep,
      CreditLedger,
      TokenUsage,
      Notification,
      NotificationPreference,
    ]),
    BullModule.registerQueue({ name: 'gdpr' }), // API side: enqueues export jobs
    StorageModule,
    IntegrationCallsModule,
  ],
  controllers: [GdprController],
  providers: [GdprService],
})
export class GdprModule {}
