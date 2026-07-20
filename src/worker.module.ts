import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, Env } from './config/config.module';
import { NotificationsModule } from './notifications/notifications.module';
import { StorageModule } from './storage/storage.module';
import { Resume } from './resumes/entities/resume.entity';
import { ResumeSection } from './resumes/entities/resume-section.entity';
import { ResumeProcessor } from './worker/processors/resume.processor';
import { TextExtractorService } from './resumes/services/text-extractor.service';
import { ResumeParserService } from './resumes/services/resume-parser.service';
import { AiModule } from './ai/ai.module';
import { dataSourceOptions } from './database/data-source';

// The worker process's own root module. Originally deliberately narrow (just
// EmailProcessor, no Postgres) — as of Sprint 2, ResumeProcessor reads/writes
// resumes directly from here, so this now needs TypeOrm + StorageModule too.
// It still does NOT import AuthModule/EventEmitterModule: the worker never
// emits domain events, only consumes jobs the API process already queued.
// Sprint 3 adds AiModule here (not in AppModule) — AI parsing is worker-only work,
// and keeping it out of the API process's DI graph keeps that process's boot light.
@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forRootAsync({ useFactory: () => dataSourceOptions }),
    TypeOrmModule.forFeature([Resume, ResumeSection]),
    BullModule.forRootAsync({
      useFactory: (env: Env) => ({ connection: { url: env.get('REDIS_URL') } }),
      inject: [Env],
    }),
    BullModule.registerQueue({ name: 'resumes' }), // worker side: consumes
    StorageModule,
    NotificationsModule,
    AiModule,
  ],
  providers: [ResumeProcessor, TextExtractorService, ResumeParserService],
})
export class WorkerModule {}
