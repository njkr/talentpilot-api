import { RedisHealthIndicator } from './redis-health.indicator';

function build() {
  const env = { get: jest.fn().mockReturnValue('redis://localhost:6379') };
  const session = {
    up: jest.fn((data?: unknown) => ({
      x: { status: 'up', ...(data as object) },
    })),
    down: jest.fn((data?: unknown) => ({
      x: { status: 'down', ...(data as object) },
    })),
  };
  const indicators = { check: jest.fn().mockReturnValue(session) };

  const indicator = new RedisHealthIndicator(env as any, indicators as any);
  const redis = { ping: jest.fn(), disconnect: jest.fn() };
  // Skip onModuleInit (would open a real ioredis connection) — inject the fake directly.
  (indicator as any).redis = redis;

  return { indicator, redis, session, indicators };
}

describe('RedisHealthIndicator.isHealthy', () => {
  it('reports up when Redis responds to PING', async () => {
    const { indicator, redis, session } = build();
    redis.ping.mockResolvedValue('PONG');

    await indicator.isHealthy('redis');

    expect(session.up).toHaveBeenCalled();
    expect(session.down).not.toHaveBeenCalled();
  });

  it('reports down with the error message when Redis is unreachable', async () => {
    const { indicator, redis, session } = build();
    redis.ping.mockRejectedValue(new Error('connect ECONNREFUSED'));

    await indicator.isHealthy('redis');

    expect(session.down).toHaveBeenCalledWith({
      message: 'connect ECONNREFUSED',
    });
  });
});
