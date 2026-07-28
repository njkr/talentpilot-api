import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PipelineRun } from '../pipeline/entities/pipeline-run.entity';
import { PipelineStep } from '../pipeline/entities/pipeline-step.entity';
import { TokenUsage } from '../ai/entities/token-usage.entity';
import { User } from '../auth/entities/user.entity';
import { Resume } from '../resumes/entities/resume.entity';
import { CoverLetter } from '../cover-letter/entities/cover-letter.entity';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { Referral } from '../referrals/entities/referral.entity';
import { Subscription } from '../payments/entities/subscription.entity';
import { Plan } from '../payments/entities/plan.entity';
import { PromptsModule } from '../prompts/prompts.module';
import { AuditModule } from '../audit/audit.module';
import { IntegrationCallsModule } from '../integration-calls/integration-calls.module';
import { AdminGuard } from './guards/admin.guard';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { AdminIntegrationsService } from './admin-integrations.service';
import { AdminIntegrationsController } from './admin-integrations.controller';
import { AdminUsersService } from './admin-users.service';
import { AdminUsersController } from './admin-users.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PipelineRun,
      PipelineStep,
      TokenUsage,
      User,
      Resume,
      CoverLetter,
      Workspace,
      Referral,
      Subscription,
      Plan,
    ]),
    // API-side registration for DLQ inspection only — this module never consumes
    // these queues, just reads/retries their failed jobs (BullMQ's Queue class
    // supports both from the same registration, same as every producer-only module).
    BullModule.registerQueue(
      { name: 'resumes' },
      { name: 'pipeline' },
      { name: 'documents' },
      { name: 'emails' },
    ),
    PromptsModule,
    AuditModule,
    IntegrationCallsModule,
  ],
  controllers: [
    AdminController,
    AdminIntegrationsController,
    AdminUsersController,
  ],
  providers: [
    AdminGuard,
    AdminService,
    AdminIntegrationsService,
    AdminUsersService,
  ],
  // AdminGuard exported so AdminPaymentsModule's controllers (plans, payment-config,
  // credit-packs, referrals — Sprint 13) can @UseGuards(AdminGuard) too, without
  // duplicating its provider registration.
  exports: [AdminGuard],
})
export class AdminModule {}
