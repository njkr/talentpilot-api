import {
  AdminIntegrationsService,
  IntegrationProviderName,
} from './admin-integrations.service';

function queryBuilder(raw: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue(raw),
    getRawMany: jest.fn().mockResolvedValue(raw),
  };
}

function build({
  tokenUsageRaw = { calls: '0', errors: '0', costUsd: '0' } as unknown,
  integrationCallsRaw = [] as unknown,
} = {}) {
  const tokenUsage = {
    createQueryBuilder: jest.fn().mockReturnValue(queryBuilder(tokenUsageRaw)),
  };
  const integrationCalls = {
    createQueryBuilder: jest
      .fn()
      .mockReturnValue(queryBuilder(integrationCallsRaw)),
  };
  const service = new AdminIntegrationsService(
    tokenUsage as any,
    integrationCalls as any,
  );
  return { service, tokenUsage, integrationCalls };
}

describe('AdminIntegrationsService.overview', () => {
  it('lists all 5 providers, zero-filling ones with no calls in the window', async () => {
    const { service } = build({
      tokenUsageRaw: { calls: '12', errors: '1', costUsd: '0.42' },
      integrationCallsRaw: [{ provider: 'resend', calls: '5', errors: '2' }],
    });

    const result = await service.overview();

    expect(result.providers).toEqual([
      { provider: 'openai', calls: 12, errors: 1, costUsd: '0.42' },
      { provider: 'resend', calls: 5, errors: 2 },
      { provider: 'tavily', calls: 0, errors: 0 },
      { provider: 'stripe', calls: 0, errors: 0 },
      { provider: 's3', calls: 0, errors: 0 },
    ]);
  });
});

describe('AdminIntegrationsService.dailyHistory', () => {
  it('queries token_usage for the openai provider', async () => {
    const openaiDaily = [
      { day: new Date('2026-07-01'), calls: '3', errors: '0', costUsd: '0.1' },
    ];
    const { service, tokenUsage, integrationCalls } = build({
      tokenUsageRaw: openaiDaily,
    });

    const result = await service.dailyHistory(
      'openai' as IntegrationProviderName,
      7,
    );

    expect(tokenUsage.createQueryBuilder).toHaveBeenCalled();
    expect(integrationCalls.createQueryBuilder).not.toHaveBeenCalled();
    expect(result.days).toEqual(openaiDaily);
  });

  it('queries integration_calls for a non-openai provider', async () => {
    const callsDaily = [
      { day: new Date('2026-07-01'), calls: '2', errors: '1' },
    ];
    const { service, tokenUsage, integrationCalls } = build({
      integrationCallsRaw: callsDaily,
    });

    const result = await service.dailyHistory(
      'tavily' as IntegrationProviderName,
      7,
    );

    expect(integrationCalls.createQueryBuilder).toHaveBeenCalled();
    expect(tokenUsage.createQueryBuilder).not.toHaveBeenCalled();
    expect(result.days).toEqual(callsDaily);
  });
});
