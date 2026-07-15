import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { AuthModule } from './auth/auth.module';
import { NotificationsModule } from './notifications/notifications.module';

@Module({
  imports: [
    ConfigModule, // §1 — must be first, everything reads env

    TypeOrmModule.forRootAsync({ useFactory: () => dataSourceOptions }), // Addendum §4.2

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
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard }, // protected by default (§7)
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: ProblemFilter }, // RFC 9457
  ],
})
export class AppModule implements NestModule {
  configure(c: MiddlewareConsumer) {
    c.apply(RequestIdMiddleware).forRoutes('*');
  }
}
