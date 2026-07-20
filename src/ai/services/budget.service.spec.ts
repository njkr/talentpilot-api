import { BudgetService } from './budget.service';

describe('BudgetService', () => {
  const envValues: Record<string, unknown> = {
    AI_KILL_SWITCH: false,
    AI_GLOBAL_DAILY_BUDGET_USD: 50,
    AI_USER_DAILY_BUDGET_USD: 2,
  };
  const env = { get: (k: string) => envValues[k] } as any;

  let getRawOne: jest.Mock;
  let qb: any;
  let repo: any;
  let service: BudgetService;

  beforeEach(() => {
    getRawOne = jest.fn();
    qb = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne,
    };
    repo = { createQueryBuilder: jest.fn().mockReturnValue(qb) };
    service = new BudgetService(repo, env);
    envValues.AI_KILL_SWITCH = false;
  });

  it('throws AI_PROVIDER_UNAVAILABLE when the kill switch is on, without even querying spend', async () => {
    envValues.AI_KILL_SWITCH = true;
    await expect(service.assertWithinBudget('user-1')).rejects.toMatchObject({
      code: 'AI_PROVIDER_UNAVAILABLE',
    });
    expect(repo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('allows a call when global and user spend are both under budget', async () => {
    getRawOne
      .mockResolvedValueOnce({ total: '10' })
      .mockResolvedValueOnce({ total: '0.5' });
    await expect(service.assertWithinBudget('user-1')).resolves.toBeUndefined();
  });

  it('throws AI_BUDGET_EXCEEDED (global) when global spend has hit the cap', async () => {
    getRawOne.mockResolvedValueOnce({ total: '50' });
    await expect(service.assertWithinBudget('user-1')).rejects.toMatchObject({
      code: 'AI_BUDGET_EXCEEDED',
      details: { scope: 'global' },
    });
  });

  it('throws AI_BUDGET_EXCEEDED (user) when user spend has hit the cap but global has not', async () => {
    getRawOne
      .mockResolvedValueOnce({ total: '10' })
      .mockResolvedValueOnce({ total: '2' });
    await expect(service.assertWithinBudget('user-1')).rejects.toMatchObject({
      code: 'AI_BUDGET_EXCEEDED',
      details: { scope: 'user' },
    });
  });

  it('skips the per-user check entirely when userId is null', async () => {
    getRawOne.mockResolvedValueOnce({ total: '10' });
    await expect(service.assertWithinBudget(null)).resolves.toBeUndefined();
    expect(getRawOne).toHaveBeenCalledTimes(1);
  });
});
