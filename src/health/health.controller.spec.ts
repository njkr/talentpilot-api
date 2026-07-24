import { HealthController } from './health.controller';

function build() {
  const health = { check: jest.fn() };
  const db = { pingCheck: jest.fn() };
  const redis = { isHealthy: jest.fn() };

  const controller = new HealthController(
    health as any,
    db as any,
    redis as any,
  );

  return { controller, health, db, redis };
}

describe('HealthController.live', () => {
  it('returns ok without checking any dependency', () => {
    const { controller, health } = build();
    expect(controller.live()).toEqual({ status: 'ok' });
    expect(health.check).not.toHaveBeenCalled();
  });
});

describe('HealthController.ready', () => {
  it('checks both Postgres and Redis', async () => {
    const { controller, health, db, redis } = build();
    health.check.mockImplementation(async (indicators: Array<() => unknown>) =>
      Promise.all(indicators.map((fn) => fn())),
    );
    db.pingCheck.mockResolvedValue({ database: { status: 'up' } });
    redis.isHealthy.mockResolvedValue({ redis: { status: 'up' } });

    await controller.ready();

    expect(db.pingCheck).toHaveBeenCalledWith('database');
    expect(redis.isHealthy).toHaveBeenCalledWith('redis');
  });
});
