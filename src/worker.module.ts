import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, Env } from './config/config.module';
import { NotificationsModule } from './notifications/notifications.module';
import { StorageModule } from './storage/storage.module';
import { Resume } from './resumes/entities/resume.entity';
import { ResumeProcessor } from './worker/processors/resume.processor';
import { TextExtractorService } from './resumes/services/text-extractor.service';
import { dataSourceOptions } from './database/data-source';

// The worker process's own root module. Originally deliberately narrow (just
// EmailProcessor, no Postgres) — as of Sprint 2, ResumeProcessor reads/writes
// resumes directly from here, so this now needs TypeOrm + StorageModule too.
// It still does NOT import AuthModule/EventEmitterModule: the worker never
// emits domain events, only consumes jobs the API process already queued.
@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forRootAsync({ useFactory: () => dataSourceOptions }),
    TypeOrmModule.forFeature([Resume]),
    BullModule.forRootAsync({
      useFactory: (env: Env) => ({ connection: { url: env.get('REDIS_URL') } }),
      inject: [Env],
    }),
    BullModule.registerQueue({ name: 'resumes' }), // worker side: consumes
    StorageModule,
    NotificationsModule,
  ],
  providers: [ResumeProcessor, TextExtractorService],
})
export class WorkerModule {}
