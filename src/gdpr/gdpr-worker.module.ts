import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/entities/user.entity';
import { Profile } from '../profiles/entities/profile.entity';
import { Resume } from '../resumes/entities/resume.entity';
import { ResumeSection } from '../resumes/entities/resume-section.entity';
import { JobDescription } from '../job-descriptions/entities/job-description.entity';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { AtsReport } from '../ats/entities/ats-report.entity';
import { CoverLetter } from '../cover-letter/entities/cover-letter.entity';
import { InterviewQuestion } from '../interview/entities/interview-question.entity';
import { CompanyInsight } from '../company/entities/company-insight.entity';
import { SalaryEstimate } from '../salary/entities/salary-estimate.entity';
import { LearningRoadmap } from '../learning-roadmap/entities/learning-roadmap.entity';
import { CreditLedger } from '../credits/entities/credit-ledger.entity';
import { Subscription } from '../payments/entities/subscription.entity';
import { StorageModule } from '../storage/storage.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { GdprExportProcessor } from '../worker/processors/gdpr-export.processor';

/** Worker-only: multi-table data collection + S3 write for GDPR exports. */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Profile,
      Resume,
      ResumeSection,
      JobDescription,
      Workspace,
      AtsReport,
      CoverLetter,
      InterviewQuestion,
      CompanyInsight,
      SalaryEstimate,
      LearningRoadmap,
      CreditLedger,
      Subscription,
    ]),
    BullModule.registerQueue({ name: 'gdpr' }),
    StorageModule,
    NotificationsModule,
  ],
  providers: [GdprExportProcessor],
})
export class GdprWorkerModule {}
