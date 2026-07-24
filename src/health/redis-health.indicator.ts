import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { Redis } from 'ioredis';
import { Env } from '../config/config.module';

/**
 * Same "own connection per service" pattern as StreamTicketService/ProgressBus — a
 * dedicated ioredis client just for pinging, not shared with anything that does real
 * work, so a health check can never contend with (or be starved by) actual traffic.
 */
@Injectable()
export class RedisHealthIndicator implements OnModuleInit, OnModuleDestroy {
  private redis!: Redis;

  constructor(
    private readonly env: Env,
    private readonly indicators: HealthIndicatorService,
  ) {}

  onModuleInit() {
    this.redis = new Redis(this.env.get('REDIS_URL'));
  }

  onModuleDestroy() {
    this.redis?.disconnect();
  }

  async isHealthy(key: string) {
    const indicator = this.indicators.check(key);
    try {
      await this.redis.ping();
      return indicator.up();
    } catch (err) {
      return indicator.down({
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
