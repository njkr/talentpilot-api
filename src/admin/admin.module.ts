import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PipelineRun } from '../pipeline/entities/pipeline-run.entity';
import { PipelineStep } from '../pipeline/entities/pipeline-step.entity';
import { TokenUsage } from '../ai/entities/token-usage.entity';
import { PromptsModule } from '../prompts/prompts.module';
import { AuditModule } from '../audit/audit.module';
import { AdminGuard } from './guards/admin.guard';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([PipelineRun, PipelineStep, TokenUsage]),
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
  ],
  controllers: [AdminController],
  providers: [AdminGuard, AdminService],
})
export class AdminModule {}
