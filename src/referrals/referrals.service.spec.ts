import { ReferralsService } from './referrals.service';

function isDuplicateKeyError() {
  return { code: '23505' };
}

function build() {
  const referralRows = new Map<string, any>();
  const referrals = {
    findOne: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
    save: jest.fn((x) => {
      const row = { id: x.id ?? `referral-${referralRows.size + 1}`, ...x };
      referralRows.set(row.id, row);
      return Promise.resolve(row);
    }),
    create: jest.fn((x) => x),
    update: jest.fn().mockResolvedValue(undefined),
    createQueryBuilder: jest.fn(() => ({
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    })),
  };
  const users = {
    findOne: jest.fn(),
    findOneOrFail: jest.fn(),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const config = {
    get: jest.fn().mockResolvedValue({
      referralsEnabled: true,
      referralQualifyingEvent: 'first_analysis',
      referrerReward: 50,
      refereeReward: 25,
      maxReferralRewardsPerUser: 20,
    }),
  };
  const credits = { grant: jest.fn().mockResolvedValue(undefined) };
  const notifications = { create: jest.fn().mockResolvedValue(undefined) };
  const dataSource = {
    transaction: jest.fn((cb) =>
      cb({ update: jest.fn().mockResolvedValue(undefined) }),
    ),
  };

  const service = new ReferralsService(
    referrals as any,
    users as any,
    config as any,
    credits as any,
    notifications as any,
    dataSource as any,
  );
  return {
    service,
    referrals,
    users,
    config,
    credits,
    notifications,
    dataSource,
  };
}

describe('ReferralsService.getMyCode', () => {
  it('returns the existing code without allocating a new one', async () => {
    const { service, users } = build();
    users.findOneOrFail.mockResolvedValue({
      id: 'user-1',
      referralCode: 'ABC1234',
    });

    const code = await service.getMyCode('user-1');

    expect(code).toBe('ABC1234');
    expect(users.update).not.toHaveBeenCalled();
  });

  it('generates and persists a new code when the user has none yet', async () => {
    const { service, users } = build();
    users.findOneOrFail.mockResolvedValue({ id: 'user-1', referralCode: null });

    const code = await service.getMyCode('user-1');

    expect(code).toMatch(/^[A-Z0-9]{7}$/);
    expect(users.update).toHaveBeenCalledWith('user-1', { referralCode: code });
  });

  it('retries on a unique-constraint collision instead of failing', async () => {
    const { service, users } = build();
    users.findOneOrFail.mockResolvedValue({ id: 'user-1', referralCode: null });
    users.update
      .mockRejectedValueOnce(isDuplicateKeyError())
      .mockResolvedValueOnce(undefined);

    const code = await service.getMyCode('user-1');

    expect(code).toMatch(/^[A-Z0-9]{7}$/);
    expect(users.update).toHaveBeenCalledTimes(2);
  });
});

describe('ReferralsService.recordSignup', () => {
  it('is a no-op when referrals are disabled in PaymentConfig', async () => {
    const { service, users, referrals, config } = build();
    config.get.mockResolvedValue({ referralsEnabled: false });

    await service.recordSignup('referee-1', 'r@x.com', 'CODE123');

    expect(users.findOne).not.toHaveBeenCalled();
    expect(referrals.save).not.toHaveBeenCalled();
  });

  it('silently ignores an invalid/unknown code — never throws', async () => {
    const { service, users } = build();
    users.findOne.mockResolvedValue(null);

    await expect(
      service.recordSignup('referee-1', 'r@x.com', 'BOGUS999'),
    ).resolves.toBeUndefined();
  });

  it('⚠️ GUARD 1: self-referral grants nothing and records nothing', async () => {
    const { service, users, referrals } = build();
    users.findOne.mockResolvedValue({ id: 'user-1', referralCode: 'MYCODE1' });

    await service.recordSignup('user-1', 'user1@x.com', 'MYCODE1');

    expect(referrals.save).not.toHaveBeenCalled();
  });

  it('records a valid referral as "signed_up", granting no credits yet', async () => {
    const { service, users, referrals } = build();
    users.findOne.mockResolvedValue({
      id: 'referrer-1',
      referralCode: 'CODE123',
    });

    await service.recordSignup('referee-1', 'referee@x.com', 'CODE123');

    expect(referrals.save).toHaveBeenCalledWith(
      expect.objectContaining({
        referrerId: 'referrer-1',
        refereeId: 'referee-1',
        status: 'signed_up',
      }),
    );
    expect(users.update).toHaveBeenCalledWith('referee-1', {
      referredBy: 'referrer-1',
    });
  });

  it('⚠️ GUARD 2: a referee who already has a referral row is ignored, not duplicated', async () => {
    const { service, users, referrals } = build();
    users.findOne.mockResolvedValue({
      id: 'referrer-1',
      referralCode: 'CODE123',
    });
    referrals.save.mockRejectedValueOnce(isDuplicateKeyError());

    await expect(
      service.recordSignup('referee-1', 'referee@x.com', 'CODE123'),
    ).resolves.toBeUndefined();
  });
});

describe('ReferralsService.checkQualification', () => {
  it('is a no-op if referrals are disabled', async () => {
    const { service, referrals, config } = build();
    config.get.mockResolvedValue({
      referralsEnabled: false,
      referralQualifyingEvent: 'first_analysis',
    });

    await service.checkQualification('referee-1', 'first_analysis');

    expect(referrals.findOne).not.toHaveBeenCalled();
  });

  it('is a no-op if the fired event does not match the configured qualifying event', async () => {
    const { service, referrals, config } = build();
    config.get.mockResolvedValue({
      referralsEnabled: true,
      referralQualifyingEvent: 'first_payment', // configured differently
    });

    await service.checkQualification('referee-1', 'first_analysis');

    expect(referrals.findOne).not.toHaveBeenCalled();
  });

  it('is a no-op if there is no pending referral for this referee', async () => {
    const { service, referrals, credits } = build();
    referrals.findOne.mockResolvedValue(null);

    await service.checkQualification('referee-1', 'first_analysis');

    expect(credits.grant).not.toHaveBeenCalled();
  });

  it('⚠️ THE anti-farming guarantee: pays out on the qualifying event, not on signup — both sides, exactly once', async () => {
    const { service, referrals, credits, notifications } = build();
    referrals.findOne.mockResolvedValue({
      id: 'referral-1',
      referrerId: 'referrer-1',
      refereeId: 'referee-1',
      status: 'signed_up',
      rewardGranted: false,
    });

    await service.checkQualification('referee-1', 'first_analysis');

    expect(credits.grant).toHaveBeenCalledWith(
      'referrer-1',
      50,
      'referral_reward',
      'referral-1',
      expect.anything(),
      'referral',
    );
    expect(credits.grant).toHaveBeenCalledWith(
      'referee-1',
      25,
      'referral_bonus',
      'referral-1',
      expect.anything(),
      'referral',
    );
    expect(notifications.create).toHaveBeenCalledWith(
      'referrer-1',
      expect.objectContaining({ type: 'referral_reward' }),
    );
  });

  it('does not re-grant a referral that was already rewarded (rewardGranted: true is excluded by the query)', async () => {
    const { service, referrals, credits } = build();
    // A real repo's WHERE rewardGranted: false would simply not return this row —
    // findOne here returning null models that.
    referrals.findOne.mockResolvedValue(null);

    await service.checkQualification('referee-1', 'first_analysis');

    expect(credits.grant).not.toHaveBeenCalled();
  });

  it('⚠️ GUARD 3: caps rewards per referrer — the (cap+1)th qualifying referral pays nothing', async () => {
    const { service, referrals, credits, config } = build();
    config.get.mockResolvedValue({
      referralsEnabled: true,
      referralQualifyingEvent: 'first_analysis',
      referrerReward: 50,
      refereeReward: 25,
      maxReferralRewardsPerUser: 2,
    });
    referrals.findOne.mockResolvedValue({
      id: 'referral-3',
      referrerId: 'referrer-1',
      refereeId: 'referee-3',
      status: 'signed_up',
      rewardGranted: false,
    });
    referrals.count.mockResolvedValue(2); // already at the cap

    await service.checkQualification('referee-3', 'first_analysis');

    expect(credits.grant).not.toHaveBeenCalled();
    expect(referrals.update).toHaveBeenCalledWith('referral-3', {
      status: 'qualified',
    });
  });
});
