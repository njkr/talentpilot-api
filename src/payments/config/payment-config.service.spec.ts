import { PaymentConfigService } from './payment-config.service';

function build() {
  const row = {
    id: 1,
    signupCreditGrant: 25,
    referrerReward: 50,
    refereeReward: 25,
    referralQualifyingEvent: 'first_analysis',
    maxReferralRewardsPerUser: 20,
    analyzeCost: 21,
    coverLetterRegenCost: 2,
    interviewFeedbackCost: 1,
    referralsEnabled: true,
    creditPacksEnabled: true,
    updatedAt: new Date(),
    updatedBy: null,
  };
  const repo = {
    findOne: jest.fn().mockResolvedValue(row),
    findOneOrFail: jest.fn().mockResolvedValue(row),
    save: jest.fn(),
    create: jest.fn((x) => x),
    update: jest.fn().mockImplementation((_id, patch) => {
      Object.assign(row, patch);
      return Promise.resolve(undefined);
    }),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new PaymentConfigService(repo as any, audit as any);
  return { service, repo, audit, row };
}

describe('PaymentConfigService', () => {
  it('onModuleInit seeds the singleton row if it does not exist yet', async () => {
    const { service, repo } = build();
    repo.findOne.mockResolvedValueOnce(null);

    await service.onModuleInit();

    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it('onModuleInit is a no-op if the singleton already exists', async () => {
    const { service, repo } = build();

    await service.onModuleInit();

    expect(repo.save).not.toHaveBeenCalled();
  });

  it('caches reads for the TTL window — the second get() does not hit the repo again', async () => {
    const { service, repo } = build();

    await service.get();
    await service.get();

    expect(repo.findOneOrFail).toHaveBeenCalledTimes(1);
  });

  it('update() busts the cache immediately, so the next get() reflects the change', async () => {
    const { service, repo } = build();
    await service.get(); // warm the cache

    await service.update({ analyzeCost: 30 }, 'admin-1');

    expect(repo.findOneOrFail).toHaveBeenCalledTimes(2); // once to warm, once after bust
  });

  it('update() whitelists editable fields — id/updatedAt/updatedBy from the caller are never applied', async () => {
    const { service, repo } = build();

    await service.update(
      {
        analyzeCost: 30,
        id: 999,
        updatedBy: 'someone-else',
      } as any,
      'admin-1',
    );

    const [, patch] = repo.update.mock.calls[0];
    expect(patch.id).toBeUndefined();
    expect(patch.updatedBy).toBe('admin-1'); // set by the service itself, not the caller's value
    expect(patch.analyzeCost).toBe(30);
  });

  it('update() writes an audit row', async () => {
    const { service, audit } = build();

    await service.update({ analyzeCost: 30 }, 'admin-1');

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin-1',
        actorType: 'admin',
        action: 'payment_config.updated',
        resourceType: 'payment_config',
      }),
    );
  });
});
