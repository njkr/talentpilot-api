import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule, Env } from './config/config.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AuditModule } from './audit/audit.module';
import { ProfilesModule } from './profiles/profiles.module';
import { ResumesModule } from './resumes/resumes.module';
import { JobDescriptionsModule } from './job-descriptions/job-descriptions.module';
import { AtsModule } from './ats/ats.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { dataSourceOptions } from './database/data-source';

@Module({
  imports: [
    ConfigModule, // §1 — must be first, everything reads env

    TypeOrmModule.forRootAsync({ useFactory: () => dataSourceOptions }),

    // ── THIS is what makes `this.events.emit(...)` work. ──
    // Without forRoot(), EventEmitter2 is not in the DI container and injecting it
    // throws "Nest can't resolve dependencies of AuthService (?, EventEmitter2)".
    EventEmitterModule.forRoot({
      wildcard: false,
      verboseMemoryLeak: true, // warns if you ever register >10 handlers for one event
    }),

    BullModule.forRootAsync({
      // Redis connection for all queues
      useFactory: (env: Env) => ({ connection: { url: env.get('REDIS_URL') } }),
      inject: [Env],
    }),

    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]), // global default; @Throttle overrides

    AuthModule,
    UsersModule,
    NotificationsModule, // owns the `emails` queue + EmailProcessor
    AuditModule,
    ProfilesModule,
    ResumesModule,
    JobDescriptionsModule,
    AtsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard }, // protected by default (§7)
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(c: MiddlewareConsumer) {
    c.apply(RequestIdMiddleware).forRoutes('*');
  }
}
