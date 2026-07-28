const mockStripe = {
  on: jest.fn(),
  products: {
    create: jest.fn().mockResolvedValue({ id: 'prod_default' }),
    update: jest.fn().mockResolvedValue({}),
  },
  prices: {
    create: jest.fn().mockResolvedValue({ id: 'price_default' }),
    update: jest.fn().mockResolvedValue({}),
    retrieve: jest.fn().mockResolvedValue({ unit_amount: 0, active: true }),
  },
};

jest.mock('stripe', () => jest.fn().mockImplementation(() => mockStripe));

import { StripeSyncService } from './stripe-sync.service';

function build() {
  const env = { get: jest.fn().mockReturnValue('sk_test_x') };
  const plans = { save: jest.fn((x) => Promise.resolve(x)) };
  const packs = { save: jest.fn((x) => Promise.resolve(x)) };
  const integrationCalls = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new StripeSyncService(
    env as any,
    plans as any,
    packs as any,
    integrationCalls as any,
  );
  return { service, plans, packs };
}

function makePlan(overrides: Partial<any> = {}): any {
  return {
    id: 'plan-1',
    key: 'pro',
    name: 'Pro',
    description: null,
    priceMonthlyCents: 1900,
    priceYearlyCents: 0,
    monthlyCredits: 200,
    limits: { maxResumes: 25, maxWorkspaces: 100, regenPerDay: -1 },
    stripeProductId: null,
    stripePriceIds: {},
    active: true,
    displayOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('StripeSyncService.syncPlan', () => {
  it('creates a new Stripe product + monthly price for a brand-new plan', async () => {
    const { service } = build();
    mockStripe.products.create.mockResolvedValue({ id: 'prod_new' });
    mockStripe.prices.create.mockResolvedValue({ id: 'price_new' });

    const plan = await service.syncPlan(makePlan());

    expect(mockStripe.products.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Pro' }),
    );
    expect(mockStripe.prices.create).toHaveBeenCalledWith(
      expect.objectContaining({
        product: 'prod_new',
        unit_amount: 1900,
        recurring: { interval: 'month' },
      }),
    );
    expect(plan.stripeProductId).toBe('prod_new');
    expect(plan.stripePriceIds.monthly).toBe('price_new');
  });

  it('updates the product in place (mutable) on an existing plan', async () => {
    const { service } = build();
    const plan = makePlan({
      stripeProductId: 'prod_existing',
      stripePriceIds: { monthly: 'price_existing' },
    });
    mockStripe.prices.retrieve.mockResolvedValue({
      unit_amount: 1900,
      active: true,
    });

    await service.syncPlan(plan);

    expect(mockStripe.products.create).not.toHaveBeenCalled();
    expect(mockStripe.products.update).toHaveBeenCalledWith(
      'prod_existing',
      expect.objectContaining({ name: 'Pro' }),
    );
  });

  it('⚠️ reuses the existing price when the amount has NOT changed — never mutates it', async () => {
    const { service } = build();
    const plan = makePlan({
      stripeProductId: 'prod_existing',
      stripePriceIds: { monthly: 'price_existing' },
      priceMonthlyCents: 1900,
    });
    mockStripe.prices.retrieve.mockResolvedValue({
      unit_amount: 1900, // same amount
      active: true,
    });

    const result = await service.syncPlan(plan);

    expect(mockStripe.prices.create).not.toHaveBeenCalled();
    expect(mockStripe.prices.update).not.toHaveBeenCalled();
    expect(result.stripePriceIds.monthly).toBe('price_existing');
  });

  it('⚠️ THE core rule: an amount change creates a NEW price and archives the OLD one — never mutates the amount', async () => {
    const { service } = build();
    const plan = makePlan({
      stripeProductId: 'prod_existing',
      stripePriceIds: { monthly: 'price_old' },
      priceMonthlyCents: 2400, // changed from whatever price_old was created at
    });
    mockStripe.prices.retrieve.mockResolvedValue({
      unit_amount: 1900, // the OLD amount — different from the plan's new 2400
      active: true,
    });
    mockStripe.prices.create.mockResolvedValue({ id: 'price_new' });

    const result = await service.syncPlan(plan);

    // A NEW price was created with the new amount — the old price object itself was
    // never asked to change its unit_amount (Stripe would reject that anyway).
    expect(mockStripe.prices.create).toHaveBeenCalledWith(
      expect.objectContaining({ unit_amount: 2400 }),
    );
    // The OLD price is archived (active: false), NOT deleted and NOT re-amounted.
    expect(mockStripe.prices.update).toHaveBeenCalledWith('price_old', {
      active: false,
    });
    expect(mockStripe.prices.update).not.toHaveBeenCalledWith(
      'price_old',
      expect.objectContaining({ unit_amount: expect.anything() }),
    );
    expect(result.stripePriceIds.monthly).toBe('price_new');
  });

  it('recreates the price if the old one was archived externally (inactive)', async () => {
    const { service } = build();
    const plan = makePlan({
      stripeProductId: 'prod_existing',
      stripePriceIds: { monthly: 'price_old' },
      priceMonthlyCents: 1900,
    });
    mockStripe.prices.retrieve.mockResolvedValue({
      unit_amount: 1900,
      active: false, // same amount, but no longer active
    });
    mockStripe.prices.create.mockResolvedValue({ id: 'price_new' });

    const result = await service.syncPlan(plan);

    expect(mockStripe.prices.create).toHaveBeenCalled();
    expect(result.stripePriceIds.monthly).toBe('price_new');
  });

  it('skips creating a price entirely for a zero-amount (free) plan', async () => {
    const { service } = build();
    const plan = makePlan({ priceMonthlyCents: 0, priceYearlyCents: 0 });
    mockStripe.products.create.mockResolvedValue({ id: 'prod_free' });

    const result = await service.syncPlan(plan);

    expect(mockStripe.prices.create).not.toHaveBeenCalled();
    expect(result.stripePriceIds.monthly).toBe('');
    expect(result.stripePriceIds.yearly).toBe('');
  });

  it('handles monthly and yearly prices independently', async () => {
    const { service } = build();
    const plan = makePlan({
      stripeProductId: 'prod_existing',
      priceMonthlyCents: 1900,
      priceYearlyCents: 19000,
      stripePriceIds: {},
    });
    mockStripe.prices.create
      .mockResolvedValueOnce({ id: 'price_monthly' })
      .mockResolvedValueOnce({ id: 'price_yearly' });

    const result = await service.syncPlan(plan);

    expect(mockStripe.prices.create).toHaveBeenCalledWith(
      expect.objectContaining({ recurring: { interval: 'month' } }),
    );
    expect(mockStripe.prices.create).toHaveBeenCalledWith(
      expect.objectContaining({ recurring: { interval: 'year' } }),
    );
    expect(result.stripePriceIds).toEqual({
      monthly: 'price_monthly',
      yearly: 'price_yearly',
    });
  });
});

describe('StripeSyncService.archivePlan', () => {
  it('archives the product and every price, and flips active to false — never deletes', async () => {
    const { service, plans } = build();
    const plan = makePlan({
      stripeProductId: 'prod_1',
      stripePriceIds: { monthly: 'price_m', yearly: 'price_y' },
      active: true,
    });

    const result = await service.archivePlan(plan);

    expect(mockStripe.products.update).toHaveBeenCalledWith('prod_1', {
      active: false,
    });
    expect(mockStripe.prices.update).toHaveBeenCalledWith('price_m', {
      active: false,
    });
    expect(mockStripe.prices.update).toHaveBeenCalledWith('price_y', {
      active: false,
    });
    expect(result.active).toBe(false);
    expect(plans.save).toHaveBeenCalled();
  });
});

describe('StripeSyncService.syncCreditPack', () => {
  function makePack(overrides: Partial<any> = {}): any {
    return {
      id: 'pack-1',
      name: 'Small pack',
      credits: 100,
      priceCents: 500,
      stripeProductId: null,
      stripePriceId: null,
      active: true,
      displayOrder: 0,
      bestValue: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  it('creates a ONE-TIME price (no `recurring`) for a new pack', async () => {
    const { service } = build();
    mockStripe.products.create.mockResolvedValue({ id: 'prod_pack' });
    mockStripe.prices.create.mockResolvedValue({ id: 'price_pack' });

    const pack = await service.syncCreditPack(makePack());

    const [[createArgs]] = mockStripe.prices.create.mock.calls;
    expect(createArgs.recurring).toBeUndefined();
    expect(createArgs.unit_amount).toBe(500);
    expect(pack.stripePriceId).toBe('price_pack');
  });

  it('archives the old price and creates a new one when priceCents changes', async () => {
    const { service } = build();
    const pack = makePack({
      stripeProductId: 'prod_existing',
      stripePriceId: 'price_old',
      priceCents: 900, // changed
    });
    mockStripe.prices.retrieve.mockResolvedValue({
      unit_amount: 500, // old amount
      active: true,
    });
    mockStripe.prices.create.mockResolvedValue({ id: 'price_new' });

    const result = await service.syncCreditPack(pack);

    expect(mockStripe.prices.update).toHaveBeenCalledWith('price_old', {
      active: false,
    });
    expect(result.stripePriceId).toBe('price_new');
  });

  it('reuses the existing price when priceCents is unchanged', async () => {
    const { service } = build();
    const pack = makePack({
      stripeProductId: 'prod_existing',
      stripePriceId: 'price_existing',
      priceCents: 500,
    });
    mockStripe.prices.retrieve.mockResolvedValue({
      unit_amount: 500,
      active: true,
    });

    const result = await service.syncCreditPack(pack);

    expect(mockStripe.prices.create).not.toHaveBeenCalled();
    expect(result.stripePriceId).toBe('price_existing');
  });
});
