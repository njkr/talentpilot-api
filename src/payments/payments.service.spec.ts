const mockStripe = {
  customers: { create: jest.fn() },
  checkout: { sessions: { create: jest.fn() } },
  billingPortal: { sessions: { create: jest.fn() } },
  webhooks: { constructEvent: jest.fn() },
  subscriptions: { retrieve: jest.fn(), cancel: jest.fn() },
};

jest.mock('stripe', () => jest.fn().mockImplementation(() => mockStripe));

import { PaymentsService } from './payments.service';
import { ErrorCode } from '../common/exceptions/app.exception';

function build() {
  const env = {
    get: jest.fn((key: string) => {
      const values: Record<string, string> = {
        STRIPE_SECRET_KEY: 'sk_test_x',
        STRIPE_WEBHOOK_SECRET: 'whsec_x',
        APP_URL: 'https://app.talentpilot.test',
      };
      return values[key];
    }),
  };
  const plans = { findOne: jest.fn() };
  const subscriptions = {
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue(undefined),
    save: jest.fn().mockResolvedValue(undefined),
    create: jest.fn((x) => x),
    upsert: jest.fn().mockResolvedValue(undefined),
  };
  const webhookEvents = {
    save: jest.fn().mockResolvedValue(undefined),
    create: jest.fn((x) => x),
  };
  const users = { findOne: jest.fn(), findOneOrFail: jest.fn() };
  const credits = { grant: jest.fn().mockResolvedValue(undefined) };
  const emails = { add: jest.fn().mockResolvedValue(undefined) };

  const service = new PaymentsService(
    env as any,
    plans as any,
    subscriptions as any,
    webhookEvents as any,
    users as any,
    credits as any,
    emails as any,
  );

  return {
    service,
    env,
    plans,
    subscriptions,
    webhookEvents,
    users,
    credits,
    emails,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('PaymentsService.createCheckoutSession', () => {
  it('rejects without ever calling Stripe if the Idempotency-Key header is missing', async () => {
    const { service } = build();
    await expect(
      service.createCheckoutSession('user-1', 'pro', undefined),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('rejects checkout for the free plan without ever calling Stripe', async () => {
    const { service } = build();
    await expect(
      service.createCheckoutSession('user-1', 'free', 'idem-key-1'),
    ).rejects.toThrow();
    expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('404s if the plan has no stripePriceId configured', async () => {
    const { service, plans } = build();
    plans.findOne.mockResolvedValue({ key: 'pro', stripePriceId: null });
    await expect(
      service.createCheckoutSession('user-1', 'pro', 'idem-key-1'),
    ).rejects.toThrow();
  });

  it('reuses an existing Stripe customer id instead of minting a new one', async () => {
    const { service, plans, subscriptions, users } = build();
    plans.findOne.mockResolvedValue({ key: 'pro', stripePriceId: 'price_123' });
    subscriptions.findOne.mockResolvedValue({
      id: 'sub-row-1',
      stripeCustomerId: 'cus_existing',
    });
    users.findOneOrFail.mockResolvedValue({ id: 'user-1', email: 'a@b.com' });
    mockStripe.checkout.sessions.create.mockResolvedValue({
      url: 'https://checkout/x',
    });

    const result = await service.createCheckoutSession(
      'user-1',
      'pro',
      'idem-key-1',
    );

    expect(mockStripe.customers.create).not.toHaveBeenCalled();
    expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_existing' }),
      expect.anything(),
    );
    expect(result.url).toBe('https://checkout/x');
  });

  it("passes the caller's Idempotency-Key through to Stripe's own request options", async () => {
    const { service, plans, subscriptions, users } = build();
    plans.findOne.mockResolvedValue({ key: 'pro', stripePriceId: 'price_123' });
    subscriptions.findOne.mockResolvedValue({
      id: 'sub-row-1',
      stripeCustomerId: 'cus_existing',
    });
    users.findOneOrFail.mockResolvedValue({ id: 'user-1', email: 'a@b.com' });
    mockStripe.checkout.sessions.create.mockResolvedValue({
      url: 'https://checkout/x',
    });

    await service.createCheckoutSession('user-1', 'pro', 'idem-key-1');

    expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.anything(),
      { idempotencyKey: 'idem-key-1' },
    );
  });

  it('mints a new Stripe customer when none is on file yet', async () => {
    const { service, plans, subscriptions, users } = build();
    plans.findOne.mockResolvedValue({ key: 'pro', stripePriceId: 'price_123' });
    subscriptions.findOne.mockResolvedValue(null);
    users.findOneOrFail.mockResolvedValue({ id: 'user-1', email: 'a@b.com' });
    mockStripe.customers.create.mockResolvedValue({ id: 'cus_new' });
    mockStripe.checkout.sessions.create.mockResolvedValue({
      url: 'https://checkout/y',
    });

    await service.createCheckoutSession('user-1', 'pro', 'idem-key-1');

    expect(mockStripe.customers.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'a@b.com' }),
    );
    expect(subscriptions.save).toHaveBeenCalled();
  });
});

describe('PaymentsService.createPortalSession', () => {
  it('404s a user with no Stripe customer on file (never started a paid plan)', async () => {
    const { service, subscriptions } = build();
    subscriptions.findOne.mockResolvedValue(null);

    await expect(service.createPortalSession('user-1')).rejects.toThrow();
    expect(mockStripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });

  it('creates a portal session for an existing Stripe customer', async () => {
    const { service, subscriptions } = build();
    subscriptions.findOne.mockResolvedValue({
      stripeCustomerId: 'cus_existing',
    });
    mockStripe.billingPortal.sessions.create.mockResolvedValue({
      url: 'https://billing.stripe.com/session/xyz',
    });

    const result = await service.createPortalSession('user-1');

    expect(mockStripe.billingPortal.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_existing' }),
    );
    expect(result.url).toBe('https://billing.stripe.com/session/xyz');
  });
});

describe('PaymentsService.reconcileAll', () => {
  const NOW = Math.floor(Date.now() / 1000);
  const PERIOD_START = NOW - 10 * 24 * 60 * 60; // 10 days ago
  const PERIOD_END = NOW + 20 * 24 * 60 * 60; // 20 days from now

  it('corrects status drift against the live Stripe subscription', async () => {
    const { service, subscriptions, plans } = build();
    subscriptions.find.mockResolvedValue([
      {
        id: 'sub-row-1',
        userId: 'user-1',
        planKey: 'pro',
        status: 'active',
        stripeSubscriptionId: 'sub_stripe_1',
        cancelAtPeriodEnd: false,
        lastRefillAt: new Date(PERIOD_START * 1000),
      },
    ]);
    plans.findOne.mockResolvedValue({ key: 'pro', monthlyCredits: 200 });
    mockStripe.subscriptions.retrieve.mockResolvedValue({
      status: 'past_due',
      cancel_at_period_end: false,
      items: {
        data: [
          {
            current_period_start: PERIOD_START,
            current_period_end: PERIOD_END,
          },
        ],
      },
    });

    const result = await service.reconcileAll();

    expect(subscriptions.update).toHaveBeenCalledWith(
      'sub-row-1',
      expect.objectContaining({ status: 'past_due' }),
    );
    expect(result.corrected).toBe(1);
  });

  it('grants a missed monthly refill when lastRefillAt predates the current period', async () => {
    const { service, subscriptions, plans, credits } = build();
    subscriptions.find.mockResolvedValue([
      {
        id: 'sub-row-1',
        userId: 'user-1',
        planKey: 'pro',
        status: 'active',
        stripeSubscriptionId: 'sub_stripe_1',
        cancelAtPeriodEnd: false,
        // Last refilled during a PREVIOUS period — this period's webhook never arrived.
        lastRefillAt: new Date((PERIOD_START - 30 * 24 * 60 * 60) * 1000),
      },
    ]);
    plans.findOne.mockResolvedValue({ key: 'pro', monthlyCredits: 200 });
    mockStripe.subscriptions.retrieve.mockResolvedValue({
      status: 'active',
      cancel_at_period_end: false,
      items: {
        data: [
          {
            current_period_start: PERIOD_START,
            current_period_end: PERIOD_END,
          },
        ],
      },
    });

    const result = await service.reconcileAll();

    expect(credits.grant).toHaveBeenCalledWith(
      'user-1',
      200,
      'monthly_refill',
      'sub-row-1',
      undefined,
      'subscription',
    );
    expect(subscriptions.update).toHaveBeenCalledWith(
      'sub-row-1',
      expect.objectContaining({ lastRefillAt: new Date(PERIOD_START * 1000) }),
    );
    expect(result.refilled).toBe(1);
  });

  it('does NOT re-grant when the subscription was already refilled this period', async () => {
    const { service, subscriptions, plans, credits } = build();
    subscriptions.find.mockResolvedValue([
      {
        id: 'sub-row-1',
        userId: 'user-1',
        planKey: 'pro',
        status: 'active',
        stripeSubscriptionId: 'sub_stripe_1',
        cancelAtPeriodEnd: false,
        // Already refilled AFTER this period started.
        lastRefillAt: new Date((PERIOD_START + 1000) * 1000),
      },
    ]);
    plans.findOne.mockResolvedValue({ key: 'pro', monthlyCredits: 200 });
    mockStripe.subscriptions.retrieve.mockResolvedValue({
      status: 'active',
      cancel_at_period_end: false,
      items: {
        data: [
          {
            current_period_start: PERIOD_START,
            current_period_end: PERIOD_END,
          },
        ],
      },
    });

    const result = await service.reconcileAll();

    expect(credits.grant).not.toHaveBeenCalled();
    expect(result.refilled).toBe(0);
  });

  it('does not let one failing subscription abort reconciliation for the rest', async () => {
    const { service, subscriptions } = build();
    subscriptions.find.mockResolvedValue([
      { id: 'sub-bad', stripeSubscriptionId: 'sub_bad', status: 'active' },
      { id: 'sub-ok', stripeSubscriptionId: 'sub_ok', status: 'active' },
    ]);
    mockStripe.subscriptions.retrieve
      .mockRejectedValueOnce(new Error('stripe down'))
      .mockResolvedValueOnce({
        status: 'active',
        cancel_at_period_end: false,
        items: { data: [] },
      });

    const result = await service.reconcileAll();

    expect(result.checked).toBe(2);
    expect(mockStripe.subscriptions.retrieve).toHaveBeenCalledTimes(2);
  });
});

describe('PaymentsService.handleWebhook', () => {
  it('throws WEBHOOK_SIGNATURE_INVALID if Stripe signature verification fails', async () => {
    const { service } = build();
    mockStripe.webhooks.constructEvent.mockImplementation(() => {
      throw new Error('bad signature');
    });
    await expect(
      service.handleWebhook(Buffer.from('{}'), 'bad-sig'),
    ).rejects.toMatchObject({ code: ErrorCode.WEBHOOK_SIGNATURE_INVALID });
  });

  it('is idempotent — a duplicate event id is skipped silently, not reprocessed', async () => {
    const { service, webhookEvents, subscriptions } = build();
    mockStripe.webhooks.constructEvent.mockReturnValue({
      id: 'evt_1',
      type: 'customer.subscription.updated',
      created: 1000,
      data: { object: {} },
    });
    webhookEvents.save.mockRejectedValue({ code: '23505' });

    await service.handleWebhook(Buffer.from('{}'), 'sig');

    expect(subscriptions.findOne).not.toHaveBeenCalled();
  });

  it('propagates a non-duplicate-key error from the webhook_events insert', async () => {
    const { service, webhookEvents } = build();
    mockStripe.webhooks.constructEvent.mockReturnValue({
      id: 'evt_2',
      type: 'invoice.payment_succeeded',
      created: 1000,
      data: { object: {} },
    });
    webhookEvents.save.mockRejectedValue(new Error('db down'));

    await expect(
      service.handleWebhook(Buffer.from('{}'), 'sig'),
    ).rejects.toThrow('db down');
  });

  it('invoice.payment_succeeded grants the plan monthly credits and reactivates a past_due sub', async () => {
    const { service, subscriptions, plans, credits } = build();
    mockStripe.webhooks.constructEvent.mockReturnValue({
      id: 'evt_3',
      type: 'invoice.payment_succeeded',
      created: 1000,
      data: { object: { subscription: 'sub_stripe_1' } },
    });
    subscriptions.findOne.mockResolvedValue({
      id: 'sub-row-1',
      userId: 'user-1',
      planKey: 'pro',
      status: 'past_due',
      stripeSubscriptionId: 'sub_stripe_1',
    });
    plans.findOne.mockResolvedValue({ key: 'pro', monthlyCredits: 200 });

    await service.handleWebhook(Buffer.from('{}'), 'sig');

    expect(credits.grant).toHaveBeenCalledWith(
      'user-1',
      200,
      'monthly_refill',
      'sub-row-1',
      undefined,
      'subscription',
    );
    expect(subscriptions.update).toHaveBeenCalledWith('sub-row-1', {
      status: 'active',
    });
  });

  it('customer.subscription.updated ignores an event OLDER than the last one applied', async () => {
    const { service, subscriptions } = build();
    mockStripe.webhooks.constructEvent.mockReturnValue({
      id: 'evt_4',
      type: 'customer.subscription.updated',
      created: 500, // older than lastEventAt below
      data: {
        object: {
          id: 'sub_stripe_1',
          status: 'past_due',
          cancel_at_period_end: false,
          items: { data: [{ current_period_end: 2000 }] },
        },
      },
    });
    subscriptions.findOne.mockResolvedValue({
      id: 'sub-row-1',
      stripeSubscriptionId: 'sub_stripe_1',
      lastEventAt: new Date(1000 * 1000), // newer than the incoming event's 500
      status: 'active',
    });

    await service.handleWebhook(Buffer.from('{}'), 'sig');

    expect(subscriptions.update).not.toHaveBeenCalled();
  });

  it('customer.subscription.updated applies a NEWER event normally', async () => {
    const { service, subscriptions } = build();
    mockStripe.webhooks.constructEvent.mockReturnValue({
      id: 'evt_5',
      type: 'customer.subscription.updated',
      created: 5000,
      data: {
        object: {
          id: 'sub_stripe_1',
          status: 'active',
          cancel_at_period_end: true,
          items: { data: [{ current_period_end: 6000 }] },
        },
      },
    });
    subscriptions.findOne.mockResolvedValue({
      id: 'sub-row-1',
      stripeSubscriptionId: 'sub_stripe_1',
      lastEventAt: new Date(1000 * 1000),
      status: 'past_due',
      currentPeriodEnd: null,
    });

    await service.handleWebhook(Buffer.from('{}'), 'sig');

    expect(subscriptions.update).toHaveBeenCalledWith(
      'sub-row-1',
      expect.objectContaining({ status: 'active', cancelAtPeriodEnd: true }),
    );
  });
});
