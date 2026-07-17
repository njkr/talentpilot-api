import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, Env } from './config/config.module';
import { NotificationsModule } from './notifications/notifications.module';

// The worker process's own root module — deliberately narrow. It needs just
// enough to run EmailProcessor: config (for Env) and the Redis connection for
// BullMQ. It does NOT import AuthModule/TypeOrmModule/EventEmitterModule; the
// worker never touches Postgres or emits domain events, only consumes jobs
// that AuthListener (running in the API process) already queued.
@Module({
  imports: [
    ConfigModule,
    BullModule.forRootAsync({
      useFactory: (env: Env) => ({ connection: { url: env.get('REDIS_URL') } }),
      inject: [Env],
    }),
    NotificationsModule,
  ],
})
export class WorkerModule {}
