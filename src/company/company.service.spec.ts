import { CompanyService } from './company.service';

function build() {
  const complete = jest.fn().mockResolvedValue({
    data: {
      overview: 'A payments company.',
      culture: ['Fast-paced'],
      talkingPoints: ['Recent expansion'],
      sources: ['https://example.com/article'],
      confidence: 'high',
    },
    usage: {},
  });
  const ai = { complete } as any;
  const research = jest.fn().mockResolvedValue([
    {
      title: 'Stripe culture',
      url: 'https://example.com/article',
      content: 'Stripe is...',
    },
  ]);
  const tavily = { research } as any;

  const cacheStore = new Map<string, any>();
  const cache = {
    findOne: jest.fn(({ where }: any) => {
      const row = cacheStore.get(where.companyHash);
      if (!row) return Promise.resolve(null);
      return Promise.resolve(row.expiresAt > new Date() ? row : null);
    }),
    create: jest.fn((x: any) => x),
    save: jest.fn((x: any) => {
      cacheStore.set(x.companyHash, x);
      return Promise.resolve(x);
    }),
  };
  const insights = {
    create: jest.fn((x: any) => x),
    save: jest.fn((x: any) => Promise.resolve({ id: 'insight-1', ...x })),
    findOne: jest.fn(),
  };
  const workspaces = { findOne: jest.fn() };

  const service = new CompanyService(
    ai,
    tavily,
    cache as any,
    insights as any,
    workspaces as any,
  );

  const ctxFor = (userId: string, workspaceId: string) => ({
    runId: 'run-1',
    workspaceId,
    userId,
    resume: {},
    resumeVersion: 1,
    sections: [],
    jd: { company: 'Stripe, Inc.', position: 'Engineer', parsedData: null },
    artifacts: new Map(),
  });

  return { service, complete, research, cache, insights, ctxFor };
}

describe('CompanyService.research', () => {
  it('the second user researching the same company pays nothing (cache hit)', async () => {
    const { service, research, complete, ctxFor } = build();

    await service.research(ctxFor('user-a', 'ws-a') as any);
    expect(research).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledTimes(1);

    await service.research(ctxFor('user-b', 'ws-b') as any);
    // Different user, different workspace, SAME company (just different legal-suffix
    // formatting won't even matter here — this is the identical string) — no new
    // Tavily search, no new AI call.
    expect(research).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('a cache hit still produces a per-workspace CompanyInsight copy', async () => {
    const { service, insights, ctxFor } = build();

    await service.research(ctxFor('user-a', 'ws-a') as any);
    await service.research(ctxFor('user-b', 'ws-b') as any);

    expect(insights.save).toHaveBeenCalledTimes(2);
    const secondCall = insights.save.mock.calls[1][0];
    expect(secondCall.workspaceId).toBe('ws-b');
    expect(secondCall.fromCache).toBe(true);
  });

  it('throws cleanly when the JD has no company name', async () => {
    const { service, ctxFor } = build();
    const ctx = ctxFor('user-a', 'ws-a');
    (ctx.jd as any).company = null;

    await expect(service.research(ctx as any)).rejects.toThrow(
      /no company name/i,
    );
  });
});

describe('CompanyService company-name normalisation', () => {
  it('collapses legal suffixes and casing to the same cache key', () => {
    const { service } = build();
    const norm = (s: string) => (service as any).normaliseCompany(s);

    expect(norm('Stripe, Inc.')).toBe(norm('STRIPE'));
    expect(norm('Acme Corporation')).toBe(norm('acme corp'));
    expect(norm('Acme Corp')).not.toBe(norm('Beta Corp'));
  });
});
