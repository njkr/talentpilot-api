import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Workspace } from './entities/workspace.entity';
import { WorkspacesService } from './workspaces.service';
import { WorkspacesController } from './workspaces.controller';
import { PipelineCommonModule } from '../pipeline/pipeline-common.module';
import { ResumesModule } from '../resumes/resumes.module';
import { JobDescriptionsModule } from '../job-descriptions/job-descriptions.module';
import { CreditsModule } from '../credits/credits.module';
import { PaymentConfigModule } from '../payments/config/payment-config.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { AtsReport } from '../ats/entities/ats-report.entity';
import { AtsKeywordMatch } from '../ats/entities/ats-keyword-match.entity';
import { Resume } from '../resumes/entities/resume.entity';

@Module({
  imports: [
    // AtsReport/AtsKeywordMatch repos only — NOT AtsModule itself, which would drag
    // the worker-only AI/embeddings dependency graph into the API process (same
    // boundary StepRegistry/STEP_MANIFEST keeps clean on the step-execution side).
    // Resume is registered here too (rescore() needs currentVersion to reject a
    // no-op rescore before spending credits) — same multi-registration precedent.
    TypeOrmModule.forFeature([Workspace, AtsReport, AtsKeywordMatch, Resume]),
    PipelineCommonModule, // PipelineRun/PipelineStep repos + ProgressBus + StreamTicketService
    BullModule.registerQueue(
      { name: 'pipeline' }, // API side: enqueues full-analyze jobs
      { name: 'rescore' }, // API side: enqueues rescore jobs (RescoreProcessor consumes)
    ),
    ResumesModule,
    JobDescriptionsModule,
    CreditsModule,
    PaymentConfigModule,
    SubscriptionsModule,
  ],
  controllers: [WorkspacesController],
  providers: [WorkspacesService],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}
