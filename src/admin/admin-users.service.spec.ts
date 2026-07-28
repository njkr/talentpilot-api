import { NotFoundException } from '@nestjs/common';
import { AdminUsersService } from './admin-users.service';
import { AdminUserQueryDto } from './dto/admin-user-query.dto';

function qb(result: unknown = []) {
  return {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(result),
    getRawMany: jest.fn().mockResolvedValue(result),
  };
}

function makeUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'u1',
    email: 'user@example.com',
    role: 'user',
    status: 'active',
    isVerified: true,
    createdAt: new Date('2026-07-20T00:00:00.000Z'),
    lastLoginAt: null,
    ...overrides,
  };
}

function build() {
  const usersQb = qb([]);
  const users = {
    createQueryBuilder: jest.fn().mockReturnValue(usersQb),
    findOne: jest.fn(),
    save: jest.fn((u: unknown) => Promise.resolve(u)),
  };
  const resumesQb = qb([]);
  const resumes = { createQueryBuilder: jest.fn().mockReturnValue(resumesQb) };
  const coverLettersQb = qb([]);
  const coverLetters = {
    createQueryBuilder: jest.fn().mockReturnValue(coverLettersQb),
  };
  const referralsQb = qb([]);
  const referrals = {
    createQueryBuilder: jest.fn().mockReturnValue(referralsQb),
  };
  const totalSpendQb = qb([]);
  const recentSpendQb = qb([]);
  const tokenUsage = {
    createQueryBuilder: jest
      .fn()
      .mockReturnValueOnce(totalSpendQb)
      .mockReturnValueOnce(recentSpendQb),
  };
  const subscriptions = { find: jest.fn().mockResolvedValue([]) };
  const plans = { find: jest.fn().mockResolvedValue([]) };

  const service = new AdminUsersService(
    users as any,
    resumes as any,
    coverLetters as any,
    referrals as any,
    subscriptions as any,
    plans as any,
    tokenUsage as any,
  );

  return {
    service,
    users,
    usersQb,
    resumesQb,
    coverLettersQb,
    referralsQb,
    totalSpendQb,
    recentSpendQb,
    subscriptions,
    plans,
  };
}

function query(overrides: Partial<AdminUserQueryDto> = {}): AdminUserQueryDto {
  return Object.assign(
    new AdminUserQueryDto(),
    { limit: 20, days: 30 },
    overrides,
  );
}

describe('AdminUsersService.list', () => {
  it('merges spend/resume/cover-letter/referral/plan data, defaulting missing users to zero/free', async () => {
    const {
      service,
      usersQb,
      resumesQb,
      coverLettersQb,
      referralsQb,
      totalSpendQb,
      recentSpendQb,
      subscriptions,
      plans,
    } = build();

    usersQb.getMany.mockResolvedValue([
      makeUser({ id: 'u1' }),
      makeUser({ id: 'u2', email: 'other@example.com' }),
    ]);
    totalSpendQb.getRawMany.mockResolvedValue([
      { userId: 'u1', costUsd: '1.500000' },
    ]);
    recentSpendQb.getRawMany.mockResolvedValue([
      { userId: 'u1', costUsd: '0.500000' },
    ]);
    resumesQb.getRawMany.mockResolvedValue([{ userId: 'u1', count: '3' }]);
    coverLettersQb.getRawMany.mockResolvedValue([{ userId: 'u2', count: '2' }]);
    referralsQb.getRawMany.mockResolvedValue([
      { userId: 'u1', invited: '5', qualified: '2' },
    ]);
    subscriptions.find.mockResolvedValue([{ userId: 'u2', planKey: 'pro' }]);
    plans.find.mockResolvedValue([
      { key: 'free', name: 'Free' },
      { key: 'pro', name: 'Pro' },
    ]);

    const result = await service.list(query());

    expect(result.data).toEqual([
      expect.objectContaining({
        id: 'u1',
        planKey: 'free',
        planName: 'Free',
        totalSpendUsd: '1.500000',
        spendLastNDaysUsd: '0.500000',
        resumeCount: 3,
        coverLetterCount: 0,
        referrals: { invited: 5, qualified: 2 },
      }),
      expect.objectContaining({
        id: 'u2',
        planKey: 'pro',
        planName: 'Pro',
        totalSpendUsd: '0',
        spendLastNDaysUsd: '0',
        resumeCount: 0,
        coverLetterCount: 2,
        referrals: { invited: 0, qualified: 0 },
      }),
    ]);
  });

  it('signals hasMore and encodes a cursor when more rows exist than the page limit', async () => {
    const { service, usersQb } = build();
    usersQb.getMany.mockResolvedValue([
      makeUser({ id: 'u1' }),
      makeUser({ id: 'u2' }),
    ]);

    const result = await service.list(query({ limit: 1 }));

    expect(result.hasMore).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.nextCursor).toEqual(expect.any(String));
  });

  it('returns an empty page without querying any of the aggregate sources', async () => {
    const {
      service,
      usersQb,
      resumesQb,
      coverLettersQb,
      referralsQb,
      subscriptions,
      plans,
    } = build();
    usersQb.getMany.mockResolvedValue([]);

    const result = await service.list(query());

    expect(result).toEqual(
      expect.objectContaining({ data: [], hasMore: false, nextCursor: null }),
    );
    expect(resumesQb.getRawMany).not.toHaveBeenCalled();
    expect(coverLettersQb.getRawMany).not.toHaveBeenCalled();
    expect(referralsQb.getRawMany).not.toHaveBeenCalled();
    expect(subscriptions.find).not.toHaveBeenCalled();
    expect(plans.find).not.toHaveBeenCalled();
  });

  it('applies search and status filters to the users query', async () => {
    const { service, usersQb } = build();
    usersQb.getMany.mockResolvedValue([]);

    await service.list(query({ search: 'foo', status: 'suspended' }));

    expect(usersQb.andWhere).toHaveBeenCalledWith('u.email ILIKE :search', {
      search: '%foo%',
    });
    expect(usersQb.andWhere).toHaveBeenCalledWith('u.status = :status', {
      status: 'suspended',
    });
  });
});

describe('AdminUsersService.suspend', () => {
  it('rejects an admin trying to suspend their own account, without touching the DB', async () => {
    const { service, users } = build();

    await expect(service.suspend('admin-1', 'admin-1')).rejects.toMatchObject({
      code: 'SELF_ACTION_FORBIDDEN',
    });
    expect(users.findOne).not.toHaveBeenCalled();
  });

  it('404s for an unknown target user', async () => {
    const { service, users } = build();
    users.findOne.mockResolvedValue(null);

    await expect(service.suspend('ghost', 'admin-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('flips status to suspended and returns the previous status', async () => {
    const { service, users } = build();
    users.findOne.mockResolvedValue(
      makeUser({ id: 'target', status: 'active' }),
    );

    const result = await service.suspend('target', 'admin-1');

    expect(result).toEqual({ previousStatus: 'active' });
    expect(users.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'target', status: 'suspended' }),
    );
  });
});

describe('AdminUsersService.activate', () => {
  it('404s for an unknown target user', async () => {
    const { service, users } = build();
    users.findOne.mockResolvedValue(null);

    await expect(service.activate('ghost')).rejects.toThrow(NotFoundException);
  });

  it('flips status to active and returns the previous status', async () => {
    const { service, users } = build();
    users.findOne.mockResolvedValue(
      makeUser({ id: 'target', status: 'suspended' }),
    );

    const result = await service.activate('target');

    expect(result).toEqual({ previousStatus: 'suspended' });
    expect(users.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'target', status: 'active' }),
    );
  });
});
