const mockStripe = {
  on: jest.fn(),
  checkout: { sessions: { create: jest.fn() } },
};

jest.mock('stripe', () => jest.fn().mockImplementation(() => mockStripe));

import { CreditPacksService } from './credit-packs.service';

function build() {
  const env = {
    get: jest.fn((key: string) => {
      const values: Record<string, string> = {
        STRIPE_SECRET_KEY: 'sk_test_x',
        APP_URL: 'https://app.talentpilot.test',
      };
      return values[key];
    }),
  };
  const packs = { findOne: jest.fn() };
  const config = {
    get: jest.fn().mockResolvedValue({ creditPacksEnabled: true }),
  };
  const payments = {
    ensureStripeCustomer: jest.fn().mockResolvedValue('cus_1'),
  };
  const integrationCalls = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new CreditPacksService(
    env as any,
    packs as any,
    config as any,
    payments as any,
    integrationCalls as any,
  );
  return { service, packs, config, payments };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStripe.checkout.sessions.create.mockResolvedValue({
    url: 'https://checkout.stripe.com/pack',
  });
});

describe('CreditPacksService.createCheckout', () => {
  it('rejects without ever calling Stripe if the Idempotency-Key is missing', async () => {
    const { service } = build();
    await expect(
      service.createCheckout('user-1', 'a@b.com', 'pack-1', undefined),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('throws FEATURE_DISABLED when creditPacksEnabled is false in PaymentConfig', async () => {
    const { service, config } = build();
    config.get.mockResolvedValue({ creditPacksEnabled: false });
    await expect(
      service.createCheckout('user-1', 'a@b.com', 'pack-1', 'idem-1'),
    ).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
    expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('404s if the pack does not exist, is inactive, or has no stripePriceId', async () => {
    const { service, packs } = build();
    packs.findOne.mockResolvedValue(null);
    await expect(
      service.createCheckout('user-1', 'a@b.com', 'pack-1', 'idem-1'),
    ).rejects.toThrow();
  });

  it('creates a `mode: payment` session (one-time, NOT a subscription)', async () => {
    const { service, packs } = build();
    packs.findOne.mockResolvedValue({
      id: 'pack-1',
      credits: 100,
      stripePriceId: 'price_100',
      active: true,
    });

    await service.createCheckout('user-1', 'a@b.com', 'pack-1', 'idem-1');

    expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'payment',
        customer: 'cus_1',
        line_items: [{ price: 'price_100', quantity: 1 }],
      }),
      { idempotencyKey: 'idem-1' },
    );
  });

  it('sets metadata the webhook handler needs to grant credits (type/userId/packId/credits)', async () => {
    const { service, packs } = build();
    packs.findOne.mockResolvedValue({
      id: 'pack-1',
      credits: 100,
      stripePriceId: 'price_100',
      active: true,
    });

    await service.createCheckout('user-1', 'a@b.com', 'pack-1', 'idem-1');

    expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          type: 'credit_pack',
          userId: 'user-1',
          packId: 'pack-1',
          credits: '100',
        },
      }),
      expect.anything(),
    );
  });

  it('reuses PaymentsService.ensureStripeCustomer rather than minting its own customer', async () => {
    const { service, packs, payments } = build();
    packs.findOne.mockResolvedValue({
      id: 'pack-1',
      credits: 100,
      stripePriceId: 'price_100',
      active: true,
    });

    await service.createCheckout('user-1', 'a@b.com', 'pack-1', 'idem-1');

    expect(payments.ensureStripeCustomer).toHaveBeenCalledWith(
      'user-1',
      'a@b.com',
    );
  });
});
