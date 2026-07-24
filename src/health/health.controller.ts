import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { RawResponse } from '../common/decorators/raw-response.decorator';
import { RedisHealthIndicator } from './redis-health.indicator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  @Get('live')
  @Public()
  @RawResponse() // orchestrators expect a plain body, not our {success,data,meta} envelope
  @ApiOperation({
    summary: 'Liveness — is the process itself responsive?',
    description:
      'Deliberately checks NO dependency. A Postgres/Redis outage should page someone, ' +
      "not trigger a container-restart storm on every replica — that's what readiness " +
      "is for. If this doesn't return 200, the process itself is wedged and a restart " +
      'is the correct orchestrator action.',
  })
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  @Public()
  @RawResponse()
  @HealthCheck()
  @ApiOperation({
    summary: 'Readiness — can this instance actually serve traffic?',
    description:
      'Pings Postgres and Redis. 503s (via HealthCheckService, not our normal error ' +
      'envelope) if either is unreachable — a deploy should gate on this, and a load ' +
      'balancer should stop routing to an instance failing it.',
  })
  ready() {
    return this.health.check([
      () => this.db.pingCheck('database'),
      () => this.redis.isHealthy('redis'),
    ]);
  }
}
