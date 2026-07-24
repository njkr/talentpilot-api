import { CreditService } from './credit.service';

function fakeManager(balanceValue: number) {
  const query = jest.fn().mockResolvedValue(undefined);
  const save = jest.fn((row) => Promise.resolve(row));
  const create = jest.fn((x) => x);
  const getRawOne = jest
    .fn()
    .mockResolvedValue({ total: String(balanceValue) });
  const repo = {
    save,
    create,
    createQueryBuilder: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawOne,
    }),
  };
  const manager = { query, getRepository: jest.fn().mockReturnValue(repo) };
  return { manager, query, save, repo };
}

describe('CreditService', () => {
  describe('balance', () => {
    it('sums the ledger for a user', async () => {
      const getRawOne = jest.fn().mockResolvedValue({ total: '42' });
      const repo = {
        createQueryBuilder: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          getRawOne,
        }),
      };
      const service = new CreditService(repo as any, {} as any);
      await expect(service.balance('user-1')).resolves.toBe(42);
    });

    it('returns 0 for a user with no ledger rows', async () => {
      const getRawOne = jest.fn().mockResolvedValue({ total: null });
      const repo = {
        createQueryBuilder: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          getRawOne,
        }),
      };
      const service = new CreditService(repo as any, {} as any);
      await expect(service.balance('user-1')).resolves.toBe(0);
    });
  });

  describe('debitWithin', () => {
    it('takes the advisory lock before checking balance', async () => {
      const { manager, query } = fakeManager(100);
      const service = new CreditService({} as any, {} as any);
      await service.debitWithin(
        manager as any,
        'user-1',
        10,
        'analyze',
        'run-1',
      );
      expect(query).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        ['user-1'],
      );
    });

    it('inserts a negative ledger row when balance is sufficient', async () => {
      const { manager, save } = fakeManager(100);
      const service = new CreditService({} as any, {} as any);
      await service.debitWithin(
        manager as any,
        'user-1',
        10,
        'analyze',
        'run-1',
      );
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          amount: -10,
          reason: 'analyze',
          referenceId: 'run-1',
        }),
      );
    });

    it('throws INSUFFICIENT_CREDITS and does not write a ledger row when balance is too low', async () => {
      const { manager, save } = fakeManager(5);
      const service = new CreditService({} as any, {} as any);
      await expect(
        service.debitWithin(manager as any, 'user-1', 10, 'analyze', 'run-1'),
      ).rejects.toMatchObject({
        code: 'INSUFFICIENT_CREDITS',
        details: { required: 10, balance: 5 },
      });
      expect(save).not.toHaveBeenCalled();
    });

    it('treats an exact-balance debit as sufficient (>=, not >)', async () => {
      const { manager, save } = fakeManager(10);
      const service = new CreditService({} as any, {} as any);
      await service.debitWithin(
        manager as any,
        'user-1',
        10,
        'analyze',
        'run-1',
      );
      expect(save).toHaveBeenCalled();
    });
  });

  describe('history', () => {
    it('returns the most recent rows for a user, cursor-paginated', async () => {
      const rows = Array.from({ length: 21 }, (_, i) => ({
        id: `ledger-${i}`,
        createdAt: new Date(2024, 0, i + 1),
        amount: 1,
      }));
      const qb = {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(rows),
      };
      const repo = { createQueryBuilder: jest.fn().mockReturnValue(qb) };
      const service = new CreditService(repo as any, {} as any);

      const page = await service.history('user-1', { limit: 20 } as any);

      expect(qb.where).toHaveBeenCalledWith('l.user_id = :userId', {
        userId: 'user-1',
      });
      expect(page.data).toHaveLength(20);
      expect(page.hasMore).toBe(true);
      expect(page.nextCursor).not.toBeNull();
    });
  });

  describe('grant / refund', () => {
    it('grant always succeeds regardless of balance', async () => {
      const save = jest.fn((row) => Promise.resolve(row));
      const create = jest.fn((x) => x);
      const service = new CreditService({ save, create } as any, {} as any);
      await service.grant('user-1', 100, 'signup_bonus');
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          amount: 100,
          reason: 'signup_bonus',
        }),
      );
    });

    it('refund is a positive-amount grant tagged with the run it refunds', async () => {
      const save = jest.fn((row) => Promise.resolve(row));
      const create = jest.fn((x) => x);
      const service = new CreditService({ save, create } as any, {} as any);
      await service.refund('user-1', 5, 'refund', 'run-1');
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          amount: 5,
          reason: 'refund',
          referenceId: 'run-1',
        }),
      );
    });
  });
});
