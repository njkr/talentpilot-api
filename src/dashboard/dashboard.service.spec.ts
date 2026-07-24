import { DashboardService } from './dashboard.service';

function build() {
  const env = { get: jest.fn().mockReturnValue('redis://localhost:6379') };
  const resumes = { count: jest.fn().mockResolvedValue(2) };
  const workspaces = {
    count: jest.fn().mockResolvedValue(0),
    find: jest.fn().mockResolvedValue([]),
  };
  const credits = { balance: jest.fn().mockResolvedValue(42) };
  const payments = {
    getSubscription: jest
      .fn()
      .mockResolvedValue({ plan: null, subscription: null }),
  };
  const notifications = { unreadCount: jest.fn().mockResolvedValue(0) };
  const redis = {
    get: jest.fn().mockResolvedValue(null),
    setex: jest.fn().mockResolvedValue('OK'),
  };

  const service = new DashboardService(
    env as any,
    resumes as any,
    workspaces as any,
    credits as any,
    payments as any,
    notifications as any,
  );
  // Skip onModuleInit (would open a real ioredis connection) — inject the fake directly.
  (service as any).redis = redis;

  return {
    service,
    resumes,
    workspaces,
    credits,
    payments,
    notifications,
    redis,
  };
}

describe('DashboardService.getOverview', () => {
  it('returns the cached overview on a cache hit without touching any repo', async () => {
    const { service, redis, resumes } = build();
    const cached = {
      creditBalance: 99,
      plan: { key: 'free', name: 'Free', status: 'active', monthlyCredits: 0 },
      resumes: { count: 1, limit: 3 },
      workspaces: {
        total: 0,
        completed: 0,
        processing: 0,
        failed: 0,
        recent: [],
      },
      unreadNotifications: 0,
    };
    redis.get.mockResolvedValue(JSON.stringify(cached));

    const result = await service.getOverview('user-1');

    expect(result.creditBalance).toBe(99);
    expect(resumes.count).not.toHaveBeenCalled();
  });

  it('on a cache miss, fetches everything in parallel and populates the cache', async () => {
    const { service, redis, credits, resumes, workspaces, notifications } =
      build();
    credits.balance.mockResolvedValue(42);
    resumes.count.mockResolvedValue(2);
    workspaces.count
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);
    notifications.unreadCount.mockResolvedValue(4);

    const result = await service.getOverview('user-1');

    expect(result.creditBalance).toBe(42);
    expect(result.resumes.count).toBe(2);
    expect(result.unreadNotifications).toBe(4);
    expect(redis.setex).toHaveBeenCalledWith(
      'dashboard:user-1',
      30,
      expect.any(String),
    );
  });

  it('defaults plan fields to the free plan when the user has no subscription', async () => {
    const { service, payments } = build();
    payments.getSubscription.mockResolvedValue({
      plan: null,
      subscription: null,
    });

    const result = await service.getOverview('user-1');

    expect(result.plan).toEqual({
      key: 'free',
      name: 'Free',
      status: 'active',
      monthlyCredits: 0,
    });
    expect(result.resumes.limit).toBe(3);
  });
});
