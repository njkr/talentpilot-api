import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ConfigModule, Env } from './config/config.module';
import { NotificationsModule } from './notifications/notifications.module';
import { StorageModule } from './storage/storage.module';
import { Resume } from './resumes/entities/resume.entity';
import { ResumeSection } from './resumes/entities/resume-section.entity';
import { ResumeProcessor } from './worker/processors/resume.processor';
import { PipelineProcessor } from './worker/processors/pipeline.processor';
import { RunJanitor } from './worker/processors/run-janitor.service';
import { TextExtractorService } from './resumes/services/text-extractor.service';
import { ResumeParserService } from './resumes/services/resume-parser.service';
import { AiModule } from './ai/ai.module';
import { PipelineCommonModule } from './pipeline/pipeline-common.module';
import { PipelineWorkerModule } from './pipeline/pipeline-worker.module';
import { dataSourceOptions } from './database/data-source';

// The worker process's own root module. Originally deliberately narrow (just
// EmailProcessor, no Postgres) — as of Sprint 2, ResumeProcessor reads/writes
// resumes directly from here, so this now needs TypeOrm + StorageModule too.
// It still does NOT import AuthModule: the worker never handles HTTP auth.
// Sprint 3 adds AiModule here (not in AppModule) — AI parsing is worker-only work,
// and keeping it out of the API process's DI graph keeps that process's boot light.
// Sprint 5/6 add the 'pipeline' queue + PipelineWorkerModule (StepRunner + the 5
// analysis steps) — same reasoning, the full AI/embeddings/ATS graph stays worker-side.
// EventEmitterModule is registered (not because the worker emits domain events — it
// still doesn't) but because PipelineWorkerModule transitively pulls in ResumesModule
// (for FileValidatorService/TextExtractorService reuse), and ResumesService itself
// requires EventEmitter2 to construct even though its event-emitting method
// (upload()) is never called from anything running in this process.
@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forRootAsync({ useFactory: () => dataSourceOptions }),
    TypeOrmModule.forFeature([Resume, ResumeSection]),
    EventEmitterModule.forRoot({ wildcard: false, verboseMemoryLeak: true }),
    BullModule.forRootAsync({
      useFactory: (env: Env) => ({ connection: { url: env.get('REDIS_URL') } }),
      inject: [Env],
    }),
    BullModule.registerQueue({ name: 'resumes' }), // worker side: consumes
    BullModule.registerQueue({ name: 'pipeline' }), // worker side: consumes
    ScheduleModule.forRoot(), // enables @Cron() — RunJanitor
    StorageModule,
    NotificationsModule,
    AiModule,
    PipelineCommonModule, // PipelineRun/PipelineStep repos — RunJanitor needs these directly
    PipelineWorkerModule, // StepRunner + steps
  ],
  providers: [
    ResumeProcessor,
    TextExtractorService,
    ResumeParserService,
    PipelineProcessor,
    RunJanitor,
  ],
})
export class WorkerModule {}
