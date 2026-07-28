const mockStripe = {
  on: jest.fn(),
  customers: { create: jest.fn() },
  checkout: { sessions: { create: jest.fn() } },
  billingPortal: { sessions: { create: jest.fn() } },
  webhooks: { constructEvent: jest.fn() },
  subscriptions: { retrieve: jest.fn(), update: jest.fn(), cancel: jest.fn() },
  subscriptionSchedules: {
    create: jest.fn(),
    update: jest.fn(),
    release: jest.fn().mockResolvedValue({}),
  },
};

jest.mock('stripe', () => jest.fn().mockImplementation(() => mockStripe));

import { PaymentsService } from './payments.service';
import { AppException, ErrorCode } from '../common/exceptions/app.exception';

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
  const plans = { findOne: jest.fn(), find: jest.fn().mockResolvedValue([]) };
  const subscriptions = {
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue(undefined),
    save: jest.fn().mockImplementation((x) => Promise.resolve(x)),
    create: jest.fn((x) => x),
    upsert: jest.fn().mockResolvedValue(undefined),
  };
  const webhookEvents = {
    save: jest.fn().mockResolvedValue(undefined),
    create: jest.fn((x) => x),
  };
  const users = { findOne: jest.fn(), findOneOrFail: jest.fn() };
  const credits = { grant: jest.fn().mockResolvedValue(undefined) };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const emails = { add: jest.fn().mockResolvedValue(undefined) };
  const integrationCalls = { record: jest.fn().mockResolvedValue(undefined) };

  const service = new PaymentsService(
    env as any,
    plans as any,
    subscriptions as any,
    webhookEvents as any,
    users as any,
    credits as any,
    audit as any,
    emails as any,
    integrationCalls as any,
  );

  return {
    service,
    env,
    plans,
    subscriptions,
    webhookEvents,
    users,
    credits,
    audit,
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

  it('404s if the plan has no stripePriceIds configured', async () => {
    const { service, plans } = build();
    plans.findOne.mockResolvedValue({ key: 'pro', stripePriceIds: {} });
    await expect(
      service.createCheckoutSession('user-1', 'pro', 'idem-key-1'),
    ).rejects.toThrow();
  });

  it('reuses an existing Stripe customer id instead of minting a new one', async () => {
    const { service, plans, subscriptions, users } = build();
    plans.findOne.mockResolvedValue({
      key: 'pro',
      stripePriceIds: { monthly: 'price_123' },
    });
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
    plans.findOne.mockResolvedValue({
      key: 'pro',
      stripePriceIds: { monthly: 'price_123' },
    });
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
    plans.findOne.mockResolvedValue({
      key: 'pro',
      stripePriceIds: { monthly: 'price_123' },
    });
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

  it('⚠️ THE GUARDRAIL: rejects checkout for a user who already has an active subscription — use /switch instead', async () => {
    const { service, subscriptions } = build();
    subscriptions.findOne.mockResolvedValue({
      id: 'sub-row-1',
      status: 'active',
      planKey: 'pro',
      stripeSubscriptionId: 'sub_stripe_1',
    });

    await expect(
      service.createCheckoutSession('user-1', 'ultimate', 'idem-key-1'),
    ).rejects.toMatchObject({ code: 'ALREADY_SUBSCRIBED' });
    expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('allows checkout for a user with a Stripe customer on file but no real subscription yet', async () => {
    const { service, plans, subscriptions, users } = build();
    // A row can exist with just a stripeCustomerId (e.g. an abandoned checkout ran
    // ensureStripeCustomer) and no stripeSubscriptionId — that user never actually
    // subscribed and must still be allowed through.
    subscriptions.findOne.mockResolvedValue({
      id: 'sub-row-1',
      status: 'active',
      stripeCustomerId: 'cus_existing',
      stripeSubscriptionId: null,
    });
    plans.findOne.mockResolvedValue({
      key: 'pro',
      stripePriceIds: { monthly: 'price_123' },
    });
    users.findOneOrFail.mockResolvedValue({ id: 'user-1', email: 'a@b.com' });
    mockStripe.checkout.sessions.create.mockResolvedValue({
      url: 'https://checkout/x',
    });

    await expect(
      service.createCheckoutSession('user-1', 'pro', 'idem-key-1'),
    ).resolves.toMatchObject({ url: 'https://checkout/x' });
  });
});

describe('PaymentsService.cancelSubscription', () => {
  it('schedules cancellation at period end, keeps planKey unchanged (still on the paid plan)', async () => {
    const { service, subscriptions } = build();
    const sub = {
      id: 'sub-row-1',
      userId: 'user-1',
      planKey: 'pro',
      status: 'active',
      stripeSubscriptionId: 'sub_stripe_1',
      cancelAtPeriodEnd: false,
      pendingPlanKey: null,
    };
    subscriptions.findOne.mockResolvedValue(sub);
    mockStripe.subscriptions.retrieve.mockResolvedValue({ schedule: null });
    mockStripe.subscriptions.update.mockResolvedValue({
      items: { data: [{ current_period_end: 5000 }] },
    });

    const result = await service.cancelSubscription('user-1');

    expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(
      'sub_stripe_1',
      {
        cancel_at_period_end: true,
      },
    );
    expect(result.cancelAtPeriodEnd).toBe(true);
    expect(result.planKey).toBe('pro'); // still Pro until the date — never dropped early
  });

  it('throws NO_ACTIVE_SUBSCRIPTION when the user has nothing to cancel', async () => {
    const { service, subscriptions } = build();
    subscriptions.findOne.mockResolvedValue(null);

    await expect(service.cancelSubscription('user-1')).rejects.toMatchObject({
      code: 'NO_ACTIVE_SUBSCRIPTION',
    });
    expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it('writes an audit row', async () => {
    const { service, subscriptions, audit } = build();
    subscriptions.findOne.mockResolvedValue({
      id: 'sub-row-1',
      userId: 'user-1',
      stripeSubscriptionId: 'sub_stripe_1',
      pendingPlanKey: null,
    });
    mockStripe.subscriptions.retrieve.mockResolvedValue({ schedule: null });
    mockStripe.subscriptions.update.mockResolvedValue({
      items: { data: [{ current_period_end: 5000 }] },
    });

    await service.cancelSubscription('user-1');

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        action: 'subscription.cancel_scheduled',
      }),
    );
  });

  it('⚠️ releases a pending downgrade schedule before cancelling — this used to 500 (bug #1)', async () => {
    const { service, subscriptions } = build();
    subscriptions.findOne.mockResolvedValue({
      id: 'sub-row-1',
      userId: 'user-1',
      planKey: 'ultimate',
      status: 'active',
      stripeSubscriptionId: 'sub_stripe_1',
      pendingPlanKey: 'pro',
      cancelAtPeriodEnd: false,
    });
    mockStripe.subscriptions.retrieve.mockResolvedValue({
      schedule: 'sub_sched_1',
    });
    mockStripe.subscriptions.update.mockResolvedValue({
      items: { data: [{ current_period_end: 5000 }] },
    });

    const result = await service.cancelSubscription('user-1');

    expect(mockStripe.subscriptionSchedules.release).toHaveBeenCalledWith(
      'sub_sched_1',
    );
    expect(result.cancelAtPeriodEnd).toBe(true);
    expect(result.pendingPlanKey).toBeNull(); // cancelling makes the pending downgrade moot
  });

  it('maps a Stripe failure to SUBSCRIPTION_UPDATE_FAILED, never a raw 500 (bug #1)', async () => {
    const { service, subscriptions } = build();
    subscriptions.findOne.mockResolvedValue({
      id: 'sub-row-1',
      userId: 'user-1',
      stripeSubscriptionId: 'sub_stripe_1',
      pendingPlanKey: null,
    });
    mockStripe.subscriptions.retrieve.mockResolvedValue({ schedule: null });
    mockStripe.subscriptions.update.mockRejectedValueOnce(
      new Error('stripe down'),
    );

    await expect(service.cancelSubscription('user-1')).rejects.toMatchObject({
      code: 'SUBSCRIPTION_UPDATE_FAILED',
    });
  });
});

describe('PaymentsService.resumeSubscription', () => {
  it('reverts a scheduled cancellation', async () => {
    const { service, subscriptions } = build();
    subscriptions.findOne.mockResolvedValue({
      id: 'sub-row-1',
      userId: 'user-1',
      stripeSubscriptionId: 'sub_stripe_1',
      cancelAtPeriodEnd: true,
    });

    const result = await service.resumeSubscription('user-1');

    expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(
      'sub_stripe_1',
      {
        cancel_at_period_end: false,
      },
    );
    expect(result.cancelAtPeriodEnd).toBe(false);
  });

  it('throws NO_SUBSCRIPTION_TO_RESUME when nothing is scheduled to cancel', async () => {
    const { service, subscriptions } = build();
    subscriptions.findOne.mockResolvedValue(null);

    await expect(service.resumeSubscription('user-1')).rejects.toMatchObject({
      code: 'NO_SUBSCRIPTION_TO_RESUME',
    });
  });
});

describe('PaymentsService.switchPlan', () => {
  function activeSub(overrides: Partial<any> = {}) {
    return {
      id: 'sub-row-1',
      userId: 'user-1',
      planKey: 'pro',
      status: 'active',
      stripeSubscriptionId: 'sub_stripe_1',
      pendingPlanKey: null,
      ...overrides,
    };
  }

  function stripeSubWithItem(overrides: Partial<any> = {}) {
    return {
      id: 'sub_stripe_1',
      schedule: null,
      items: {
        data: [
          {
            id: 'si_1',
            price: { id: 'price_pro_monthly' },
            quantity: 1,
            current_period_start: 1000,
            current_period_end: 5000,
          },
        ],
      },
      ...overrides,
    };
  }

  it('throws NO_ACTIVE_SUBSCRIPTION with no subscription to switch', async () => {
    const { service, subscriptions } = build();
    subscriptions.findOne.mockResolvedValue(null);

    await expect(
      service.switchPlan('user-1', 'ultimate', 'month'),
    ).rejects.toMatchObject({ code: 'NO_ACTIVE_SUBSCRIPTION' });
  });

  it('throws PLAN_NOT_PURCHASABLE when the target plan/interval has no price', async () => {
    const { service, subscriptions, plans } = build();
    subscriptions.findOne.mockResolvedValue(activeSub());
    plans.findOne.mockResolvedValue({ key: 'ultimate', stripePriceIds: {} });

    await expect(
      service.switchPlan('user-1', 'ultimate', 'month'),
    ).rejects.toMatchObject({ code: 'PLAN_NOT_PURCHASABLE' });
  });

  it('⚠️ rejects switching to the plan already active with a proper AppException, never a bare BadRequestException — the old bare exception got its message mangled by the global filter into a fake fields.You entry (bug #4)', async () => {
    const { service, subscriptions } = build();
    subscriptions.findOne.mockResolvedValue(
      activeSub({ planKey: 'pro', pendingPlanKey: null }),
    );

    const err = await service
      .switchPlan('user-1', 'pro', 'month')
      .catch((e) => e);

    expect(err).toBeInstanceOf(AppException); // NOT a plain BadRequestException
    expect(err.code).toBe('ALREADY_SUBSCRIBED');
    expect(err.message).toContain('already on the "pro" plan');
  });

  it('⚠️ switching to the CURRENT plan while a downgrade is pending clears it instead of erroring — the fix for the deadlock (bug #2)', async () => {
    const { service, subscriptions } = build();
    subscriptions.findOne.mockResolvedValue(
      activeSub({ planKey: 'ultimate', pendingPlanKey: 'pro' }),
    );
    mockStripe.subscriptions.retrieve.mockResolvedValue(
      stripeSubWithItem({ schedule: 'sub_sched_1' }),
    );

    const result = await service.switchPlan('user-1', 'ultimate', 'month');

    expect(mockStripe.subscriptionSchedules.release).toHaveBeenCalledWith(
      'sub_sched_1',
    );
    expect(result.planKey).toBe('ultimate');
    expect(result.pendingPlanKey).toBeNull();
  });

  it('⚠️ Pro→Ultimate UPGRADE calls subscriptions.update on the SAME subscription — never creates a second one', async () => {
    const { service, subscriptions, plans } = build();
    subscriptions.findOne.mockResolvedValue(activeSub({ planKey: 'pro' }));
    plans.findOne
      .mockResolvedValueOnce({
        key: 'ultimate',
        priceMonthlyCents: 4900,
        monthlyCredits: 1000,
        stripePriceIds: { monthly: 'price_ultimate_monthly' },
      })
      .mockResolvedValueOnce({
        key: 'pro',
        priceMonthlyCents: 1900,
        monthlyCredits: 200,
      });
    mockStripe.subscriptions.retrieve.mockResolvedValue(stripeSubWithItem());
    mockStripe.subscriptions.update.mockResolvedValue(
      stripeSubWithItem({
        items: {
          data: [
            { ...stripeSubWithItem().items.data[0], current_period_end: 9000 },
          ],
        },
      }),
    );

    const result = await service.switchPlan('user-1', 'ultimate', 'month');

    expect(mockStripe.subscriptionSchedules.create).not.toHaveBeenCalled();
    expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(
      'sub_stripe_1',
      expect.objectContaining({
        items: [{ id: 'si_1', price: 'price_ultimate_monthly' }],
        proration_behavior: 'always_invoice',
      }),
    );
    expect(result.planKey).toBe('ultimate'); // immediate
    expect(result.pendingPlanKey).toBeNull();
  });

  it('grants the credit-allotment GAP on an upgrade', async () => {
    const { service, subscriptions, plans, credits } = build();
    subscriptions.findOne.mockResolvedValue(activeSub({ planKey: 'pro' }));
    plans.findOne
      .mockResolvedValueOnce({
        key: 'ultimate',
        priceMonthlyCents: 4900,
        monthlyCredits: 1000,
        stripePriceIds: { monthly: 'price_ultimate_monthly' },
      })
      .mockResolvedValueOnce({
        key: 'pro',
        priceMonthlyCents: 1900,
        monthlyCredits: 200,
      });
    mockStripe.subscriptions.retrieve.mockResolvedValue(stripeSubWithItem());
    mockStripe.subscriptions.update.mockResolvedValue(stripeSubWithItem());

    await service.switchPlan('user-1', 'ultimate', 'month');

    expect(credits.grant).toHaveBeenCalledWith(
      'user-1',
      800, // 1000 - 200
      'plan_upgrade',
      'sub-row-1',
      undefined,
      'subscription',
    );
  });

  it('⚠️ Ultimate→Pro DOWNGRADE keeps planKey on Ultimate and sets pendingPlanKey — benefits continue until renewal', async () => {
    const { service, subscriptions, plans } = build();
    subscriptions.findOne.mockResolvedValue(activeSub({ planKey: 'ultimate' }));
    plans.findOne
      .mockResolvedValueOnce({
        key: 'pro',
        priceMonthlyCents: 1900,
        monthlyCredits: 200,
        stripePriceIds: { monthly: 'price_pro_monthly' },
      })
      .mockResolvedValueOnce({
        key: 'ultimate',
        priceMonthlyCents: 4900,
        monthlyCredits: 1000,
      });
    mockStripe.subscriptions.retrieve.mockResolvedValue(
      stripeSubWithItem({
        items: {
          data: [
            {
              id: 'si_1',
              price: { id: 'price_ultimate_monthly' },
              quantity: 1,
              current_period_start: 1000,
              current_period_end: 5000,
            },
          ],
        },
      }),
    );
    mockStripe.subscriptionSchedules.create.mockResolvedValue({
      id: 'sub_sched_1',
    });

    const result = await service.switchPlan('user-1', 'pro', 'month');

    // A Subscription Schedule was used — NOT an immediate items update, which would
    // change the underlying price object right away regardless of proration.
    expect(mockStripe.subscriptionSchedules.create).toHaveBeenCalledWith({
      from_subscription: 'sub_stripe_1',
    });
    expect(mockStripe.subscriptionSchedules.update).toHaveBeenCalledWith(
      'sub_sched_1',
      expect.objectContaining({
        phases: [
          expect.objectContaining({
            items: [{ price: 'price_ultimate_monthly', quantity: 1 }],
            start_date: 1000,
            end_date: 5000,
          }),
          expect.objectContaining({
            items: [{ price: 'price_pro_monthly', quantity: 1 }],
            start_date: 5000,
          }),
        ],
        proration_behavior: 'none',
      }),
    );
    expect(result.planKey).toBe('ultimate'); // STILL ultimate now
    expect(result.pendingPlanKey).toBe('pro'); // switches at renewal
  });

  it('an upgrade releases a previously-scheduled downgrade before making the immediate change', async () => {
    const { service, subscriptions, plans } = build();
    // The user is still on Pro (a prior downgrade FROM Ultimate hasn't taken effect
    // yet — pendingPlanKey is stale from an earlier switch) and now upgrades to
    // Ultimate again before the schedule ever applied.
    subscriptions.findOne.mockResolvedValue(
      activeSub({ planKey: 'pro', pendingPlanKey: 'free' }),
    );
    plans.findOne
      .mockResolvedValueOnce({
        key: 'ultimate',
        priceMonthlyCents: 4900,
        monthlyCredits: 1000,
        stripePriceIds: { monthly: 'price_ultimate_monthly' },
      })
      .mockResolvedValueOnce({
        key: 'pro',
        priceMonthlyCents: 1900,
        monthlyCredits: 200,
      });
    mockStripe.subscriptions.retrieve.mockResolvedValue(
      stripeSubWithItem({ schedule: 'sub_sched_1' }),
    );
    mockStripe.subscriptions.update.mockResolvedValue(stripeSubWithItem());

    await service.switchPlan('user-1', 'ultimate', 'month');

    expect(mockStripe.subscriptionSchedules.release).toHaveBeenCalledWith(
      'sub_sched_1',
    );
  });
});

describe('PaymentsService.clearPendingChange', () => {
  it('releases the schedule and clears pendingPlanKey (bug #2, explicit path)', async () => {
    const { service, subscriptions } = build();
    subscriptions.findOne.mockResolvedValue({
      id: 'sub-row-1',
      userId: 'user-1',
      planKey: 'ultimate',
      status: 'active',
      stripeSubscriptionId: 'sub_stripe_1',
      pendingPlanKey: 'pro',
    });
    mockStripe.subscriptions.retrieve.mockResolvedValue({
      schedule: 'sub_sched_1',
    });

    const result = await service.clearPendingChange('user-1');

    expect(mockStripe.subscriptionSchedules.release).toHaveBeenCalledWith(
      'sub_sched_1',
    );
    expect(result.pendingPlanKey).toBeNull();
  });

  it('throws NO_ACTIVE_SUBSCRIPTION when there is no subscription', async () => {
    const { service, subscriptions } = build();
    subscriptions.findOne.mockResolvedValue(null);

    await expect(service.clearPendingChange('user-1')).rejects.toMatchObject({
      code: 'NO_ACTIVE_SUBSCRIPTION',
    });
  });

  it('throws NO_SUBSCRIPTION_TO_RESUME when nothing is pending', async () => {
    const { service, subscriptions } = build();
    subscriptions.findOne.mockResolvedValue({
      id: 'sub-row-1',
      userId: 'user-1',
      stripeSubscriptionId: 'sub_stripe_1',
      pendingPlanKey: null,
    });

    await expect(service.clearPendingChange('user-1')).rejects.toMatchObject({
      code: 'NO_SUBSCRIPTION_TO_RESUME',
    });
    expect(mockStripe.subscriptions.retrieve).not.toHaveBeenCalled();
  });

  it('maps a Stripe failure to SUBSCRIPTION_UPDATE_FAILED, never a raw throw', async () => {
    const { service, subscriptions } = build();
    subscriptions.findOne.mockResolvedValue({
      id: 'sub-row-1',
      userId: 'user-1',
      stripeSubscriptionId: 'sub_stripe_1',
      pendingPlanKey: 'pro',
    });
    mockStripe.subscriptions.retrieve.mockRejectedValueOnce(
      new Error('stripe down'),
    );

    await expect(service.clearPendingChange('user-1')).rejects.toMatchObject({
      code: 'SUBSCRIPTION_UPDATE_FAILED',
    });
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

  it("⚠️ does NOT grant a monthly_refill for a plan-switch PRORATION invoice (billing_reason: 'subscription_update') — found live: this double-granted on top of the upgrade's own credit-gap grant", async () => {
    const { service, subscriptions, plans, credits } = build();
    mockStripe.webhooks.constructEvent.mockReturnValue({
      id: 'evt_proration_1',
      type: 'invoice.payment_succeeded',
      created: 1000,
      data: {
        object: {
          subscription: 'sub_stripe_1',
          billing_reason: 'subscription_update',
        },
      },
    });
    subscriptions.findOne.mockResolvedValue({
      id: 'sub-row-1',
      userId: 'user-1',
      planKey: 'ultimate',
      status: 'active',
      stripeSubscriptionId: 'sub_stripe_1',
    });
    plans.findOne.mockResolvedValue({ key: 'ultimate', monthlyCredits: 1000 });

    await service.handleWebhook(Buffer.from('{}'), 'sig');

    expect(credits.grant).not.toHaveBeenCalled();
  });

  it("still grants normally for a genuine renewal (billing_reason: 'subscription_cycle')", async () => {
    const { service, subscriptions, plans, credits } = build();
    mockStripe.webhooks.constructEvent.mockReturnValue({
      id: 'evt_renewal_1',
      type: 'invoice.payment_succeeded',
      created: 1000,
      data: {
        object: {
          subscription: 'sub_stripe_1',
          billing_reason: 'subscription_cycle',
        },
      },
    });
    subscriptions.findOne.mockResolvedValue({
      id: 'sub-row-1',
      userId: 'user-1',
      planKey: 'ultimate',
      status: 'active',
      stripeSubscriptionId: 'sub_stripe_1',
    });
    plans.findOne.mockResolvedValue({ key: 'ultimate', monthlyCredits: 1000 });

    await service.handleWebhook(Buffer.from('{}'), 'sig');

    expect(credits.grant).toHaveBeenCalledWith(
      'user-1',
      1000,
      'monthly_refill',
      'sub-row-1',
      undefined,
      'subscription',
    );
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

  it('⚠️ finalizes a scheduled downgrade once the Subscription Schedule flips the price: planKey updates, pendingPlanKey clears', async () => {
    const { service, subscriptions, plans } = build();
    mockStripe.webhooks.constructEvent.mockReturnValue({
      id: 'evt_downgrade_1',
      type: 'customer.subscription.updated',
      created: 5000,
      data: {
        object: {
          id: 'sub_stripe_1',
          status: 'active',
          cancel_at_period_end: false,
          items: {
            data: [
              {
                current_period_end: 6000,
                price: { id: 'price_pro_monthly' }, // the schedule just applied Pro's price
              },
            ],
          },
        },
      },
    });
    subscriptions.findOne.mockResolvedValue({
      id: 'sub-row-1',
      stripeSubscriptionId: 'sub_stripe_1',
      lastEventAt: new Date(1000 * 1000),
      status: 'active',
      planKey: 'ultimate', // still the old plan until this event
      pendingPlanKey: 'pro',
    });
    plans.find.mockResolvedValue([
      { key: 'pro', stripePriceIds: { monthly: 'price_pro_monthly' } },
      {
        key: 'ultimate',
        stripePriceIds: { monthly: 'price_ultimate_monthly' },
      },
    ]);

    await service.handleWebhook(Buffer.from('{}'), 'sig');

    expect(subscriptions.update).toHaveBeenCalledWith(
      'sub-row-1',
      expect.objectContaining({ planKey: 'pro', pendingPlanKey: null }),
    );
  });

  it('does NOT finalize a pending downgrade if the incoming price does not (yet) match it', async () => {
    const { service, subscriptions, plans } = build();
    mockStripe.webhooks.constructEvent.mockReturnValue({
      id: 'evt_downgrade_2',
      type: 'customer.subscription.updated',
      created: 5000,
      data: {
        object: {
          id: 'sub_stripe_1',
          status: 'active',
          cancel_at_period_end: false,
          items: {
            data: [
              {
                current_period_end: 6000,
                price: { id: 'price_ultimate_monthly' },
              },
            ],
          },
        },
      },
    });
    subscriptions.findOne.mockResolvedValue({
      id: 'sub-row-1',
      stripeSubscriptionId: 'sub_stripe_1',
      lastEventAt: new Date(1000 * 1000),
      status: 'active',
      planKey: 'ultimate',
      pendingPlanKey: 'pro',
    });
    plans.find.mockResolvedValue([
      { key: 'pro', stripePriceIds: { monthly: 'price_pro_monthly' } },
      {
        key: 'ultimate',
        stripePriceIds: { monthly: 'price_ultimate_monthly' },
      },
    ]);

    await service.handleWebhook(Buffer.from('{}'), 'sig');

    const [, patch] = subscriptions.update.mock.calls[0];
    expect(patch.planKey).toBeUndefined();
    expect(patch.pendingPlanKey).toBeUndefined();
  });

  it('checkout.session.completed with metadata.type "credit_pack" grants credits instead of touching subscriptions (Sprint 13)', async () => {
    const { service, subscriptions, credits } = build();
    mockStripe.webhooks.constructEvent.mockReturnValue({
      id: 'evt_pack_1',
      type: 'checkout.session.completed',
      created: 1000,
      data: {
        object: {
          id: 'cs_test_pack',
          metadata: {
            type: 'credit_pack',
            userId: 'user-1',
            packId: 'pack-uuid-1',
            credits: '100',
          },
        },
      },
    });

    await service.handleWebhook(Buffer.from('{}'), 'sig');

    expect(credits.grant).toHaveBeenCalledWith(
      'user-1',
      100,
      'purchase',
      'pack-uuid-1',
      undefined,
      'credit_pack',
    );
    expect(subscriptions.upsert).not.toHaveBeenCalled();
  });

  it('checkout.session.completed for a credit pack with missing metadata is ignored, not thrown', async () => {
    const { service, credits } = build();
    mockStripe.webhooks.constructEvent.mockReturnValue({
      id: 'evt_pack_2',
      type: 'checkout.session.completed',
      created: 1000,
      data: {
        object: { id: 'cs_test_pack_2', metadata: { type: 'credit_pack' } },
      },
    });

    await expect(
      service.handleWebhook(Buffer.from('{}'), 'sig'),
    ).resolves.not.toThrow();
    expect(credits.grant).not.toHaveBeenCalled();
  });

  it('checkout.session.completed for a subscription still upserts the subscription as before', async () => {
    const { service, subscriptions } = build();
    mockStripe.webhooks.constructEvent.mockReturnValue({
      id: 'evt_sub_1',
      type: 'checkout.session.completed',
      created: 1000,
      data: {
        object: {
          id: 'cs_test_sub',
          client_reference_id: 'user-1',
          metadata: { userId: 'user-1', planKey: 'pro' },
          subscription: 'sub_stripe_1',
          customer: 'cus_1',
        },
      },
    });

    await service.handleWebhook(Buffer.from('{}'), 'sig');

    expect(subscriptions.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        planKey: 'pro',
        stripeSubscriptionId: 'sub_stripe_1',
        status: 'active',
      }),
      { conflictPaths: ['userId'] },
    );
  });
});
