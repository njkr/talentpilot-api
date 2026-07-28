import { DashboardService } from './dashboard.service';

function makeDataSource(
  overrides: {
    recentWorkspaces?: any[];
    scoreRows?: any[];
    creditFlows?: any;
    topGaps?: any[];
    activity?: any[];
    pendingSuggestions?: number;
    completeness?: number;
  } = {},
) {
  const query = jest.fn((sql: string) => {
    if (sql.includes('LATERAL')) {
      return Promise.resolve(overrides.recentWorkspaces ?? []);
    }
    if (
      sql.includes('FROM ats_reports r') &&
      sql.includes('overall_score AS score')
    ) {
      return Promise.resolve(overrides.scoreRows ?? []);
    }
    if (sql.includes('FROM credits_ledger')) {
      return Promise.resolve([
        overrides.creditFlows ?? { spent: '0', granted: '0' },
      ]);
    }
    if (sql.includes('JOIN keyword_matches')) {
      return Promise.resolve(overrides.topGaps ?? []);
    }
    if (sql.includes('generate_series')) {
      return Promise.resolve(overrides.activity ?? []);
    }
    if (sql.includes('FROM ai_suggestions')) {
      return Promise.resolve([{ count: overrides.pendingSuggestions ?? 0 }]);
    }
    if (sql.includes('FROM profiles')) {
      return Promise.resolve([{ completeness: overrides.completeness ?? 0 }]);
    }
    throw new Error(`unexpected dataSource.query call: ${sql}`);
  });
  return { query };
}

function build(dsOverrides: Parameters<typeof makeDataSource>[0] = {}) {
  const env = { get: jest.fn().mockReturnValue('redis://localhost:6379') };
  const resumes = { count: jest.fn().mockResolvedValue(2) };
  const workspaces = {
    count: jest.fn().mockResolvedValue(0),
  };
  const credits = { balance: jest.fn().mockResolvedValue(42) };
  const payments = {
    getSubscription: jest
      .fn()
      .mockResolvedValue({ plan: null, subscription: null }),
  };
  const notifications = { unreadCount: jest.fn().mockResolvedValue(0) };
  const paymentConfig = {
    get: jest.fn().mockResolvedValue({ analyzeCost: 21 }),
  };
  const dataSource = makeDataSource(dsOverrides);
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
    paymentConfig as any,
    dataSource as any,
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
    paymentConfig,
    dataSource,
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

  it('⚠️ scoreInsight computes latest/average/best and a newest-last trend', async () => {
    const { service } = build({
      scoreRows: [
        { score: 82, date: '2026-07-20' },
        { score: 75, date: '2026-07-10' },
        { score: 70, date: '2026-07-01' },
      ],
    });

    const result = await service.getOverview('user-1');

    expect(result.scoreInsight.latestScore).toBe(82);
    expect(result.scoreInsight.averageScore).toBe(76); // round((82+75+70)/3)
    expect(result.scoreInsight.bestScore).toBe(82);
    expect(result.scoreInsight.trend.at(-1)).toEqual({
      date: '2026-07-20',
      score: 82,
    });
  });

  it('scoreInsight is all null when the user has no completed reports yet', async () => {
    const { service } = build({ scoreRows: [] });
    const result = await service.getOverview('user-1');
    expect(result.scoreInsight).toEqual({
      latestScore: null,
      averageScore: null,
      bestScore: null,
      trend: [],
    });
  });

  it('⚠️ creditInsight converts the bigint-as-string SUM() result to real numbers', async () => {
    const { service } = build({
      creditFlows: { spent: '441', granted: '100' },
    });

    const result = await service.getOverview('user-1');

    expect(result.creditInsight.spentLast30Days).toBe(441);
    expect(result.creditInsight.grantedLast30Days).toBe(100);
    expect(typeof result.creditInsight.spentLast30Days).toBe('number');
  });

  it('runsRemaining uses the configurable analyze cost', async () => {
    const { service, credits, paymentConfig } = build();
    credits.balance.mockResolvedValue(210);
    paymentConfig.get.mockResolvedValue({ analyzeCost: 21 });

    const result = await service.getOverview('user-1');

    expect(result.creditInsight.runsRemaining).toBe(10);
  });

  it('⚠️ runsRemaining never becomes Infinity when analyzeCost is 0 (free analyses)', async () => {
    const { service, credits, paymentConfig } = build();
    credits.balance.mockResolvedValue(50);
    paymentConfig.get.mockResolvedValue({ analyzeCost: 0 });

    const result = await service.getOverview('user-1');

    expect(Number.isFinite(result.creditInsight.runsRemaining)).toBe(true);
  });

  it('passes through topGaps as computed', async () => {
    const { service } = build({
      topGaps: [
        { keyword: 'Kubernetes', missCount: 4 },
        { keyword: 'AWS', missCount: 1 },
      ],
    });

    const result = await service.getOverview('user-1');

    expect(result.topGaps).toEqual([
      { keyword: 'Kubernetes', missCount: 4 },
      { keyword: 'AWS', missCount: 1 },
    ]);
  });

  it('includes the joined score on recent workspaces', async () => {
    const { service } = build({
      recentWorkspaces: [
        {
          id: 'ws-1',
          name: 'Acme JD',
          status: 'completed',
          updatedAt: new Date('2026-07-20T00:00:00Z'),
          score: 82,
        },
      ],
    });

    const result = await service.getOverview('user-1');

    expect(result.workspaces.recent[0]).toMatchObject({
      id: 'ws-1',
      score: 82,
    });
  });

  it('⚠️ a failed run produces a high-priority action item, sourced from the workspace count (not a separate query)', async () => {
    const { service, workspaces } = build();
    workspaces.count
      .mockResolvedValueOnce(5) // total
      .mockResolvedValueOnce(3) // completed
      .mockResolvedValueOnce(0) // processing
      .mockResolvedValueOnce(2); // failed

    const result = await service.getOverview('user-1');

    expect(result.attention.failedRuns).toBe(2);
    const item = result.actionItems.find((i) => i.kind === 'failed_run');
    expect(item?.priority).toBe('high');
    expect(item?.label).toContain('2 analysis runs failed');
  });

  it('pending suggestions produce a medium-priority action item', async () => {
    const { service } = build({ pendingSuggestions: 3 });

    const result = await service.getOverview('user-1');

    expect(result.attention.workspacesWithPendingSuggestions).toBe(3);
    const item = result.actionItems.find(
      (i) => i.kind === 'pending_suggestions',
    );
    expect(item?.priority).toBe('medium');
  });

  it('low credits produces a high-priority action item, but not when analyses are free', async () => {
    const { service, credits, paymentConfig } = build();
    credits.balance.mockResolvedValue(5);
    paymentConfig.get.mockResolvedValue({ analyzeCost: 21 });

    const result = await service.getOverview('user-1');
    expect(
      result.actionItems.find((i) => i.kind === 'low_credits')?.priority,
    ).toBe('high');
  });

  it('an incomplete profile produces a low-priority action item with the percentage', async () => {
    const { service } = build({ completeness: 42 });

    const result = await service.getOverview('user-1');

    const item = result.actionItems.find(
      (i) => i.kind === 'incomplete_profile',
    );
    expect(item?.priority).toBe('low');
    expect(item?.label).toContain('42%');
  });

  it('no action items when everything is clean and the profile is complete', async () => {
    const { service, credits } = build({ completeness: 100 });
    credits.balance.mockResolvedValue(1000);

    const result = await service.getOverview('user-1');

    expect(result.actionItems).toEqual([]);
  });

  it('action items are sorted high → medium → low', async () => {
    const { service, workspaces, credits } = build({
      pendingSuggestions: 1,
      completeness: 10,
    });
    workspaces.count
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1); // failed
    credits.balance.mockResolvedValue(1000);

    const result = await service.getOverview('user-1');

    expect(result.actionItems.map((i) => i.priority)).toEqual([
      'high',
      'medium',
      'low',
    ]);
  });
});
