import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
// NOT `import Stripe from 'stripe'` — this project's tsconfig has esModuleInterop
// off, and the stripe package is a TS `export =` module (no `.default`), so a
// default import silently binds to `undefined` at runtime and throws
// "stripe_1.default is not a constructor" the moment this class is instantiated.
// Same class of bug as the cookie-parser import in main.ts; `import X = require()`
// is the correct interop-free form for an `export =` module.
import Stripe = require('stripe');
import { Env } from '../config/config.module';
import { Plan, PlanKey } from './entities/plan.entity';
import {
  Subscription,
  SubscriptionStatus,
} from './entities/subscription.entity';
import { WebhookEvent } from './entities/webhook-event.entity';
import { User } from '../auth/entities/user.entity';
import { CreditService } from '../credits/credit.service';
import { AppException, ErrorCode } from '../common/exceptions/app.exception';
import { Problems } from '../common/problems';

const STRIPE_API_VERSION = '2026-06-24.dahlia' as const;

function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === '23505'
  );
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly env: Env,
    @InjectRepository(Plan) private readonly plans: Repository<Plan>,
    @InjectRepository(Subscription)
    private readonly subscriptions: Repository<Subscription>,
    @InjectRepository(WebhookEvent)
    private readonly webhookEvents: Repository<WebhookEvent>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly credits: CreditService,
    @InjectQueue('emails') private readonly emails: Queue,
  ) {
    this.stripe = new Stripe(this.env.get('STRIPE_SECRET_KEY'), {
      apiVersion: STRIPE_API_VERSION,
    });
  }

  async createCheckoutSession(
    userId: string,
    planKey: PlanKey,
    idempotencyKey?: string,
  ): Promise<{ url: string }> {
    // Same requirement as WorkspacesService.analyze() — a double-clicked "Upgrade"
    // button must not create two Stripe Checkout sessions (and, if the user actually
    // completes both, two subscriptions). Passed straight through as Stripe's OWN
    // idempotency key rather than tracked in our own table: Stripe is already the
    // system of record for checkout sessions, and its API natively deduplicates a
    // repeated request with the same key (24h window) — a local uniqueness table
    // would just be a second, redundant source of truth that could drift from it.
    if (!idempotencyKey) throw Problems.idempotencyKeyRequired();

    if (planKey === 'free') {
      throw new BadRequestException('The free plan does not require checkout.');
    }
    const plan = await this.plans.findOne({ where: { key: planKey } });
    if (!plan?.stripePriceId) {
      throw new NotFoundException(
        `Plan "${planKey}" is not available for checkout.`,
      );
    }

    const user = await this.users.findOneOrFail({ where: { id: userId } });
    const customerId = await this.ensureStripeCustomer(userId, user.email);

    const session = await this.stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: plan.stripePriceId, quantity: 1 }],
        success_url: `${this.env.get('APP_URL')}/billing?checkout=success`,
        cancel_url: `${this.env.get('APP_URL')}/billing?checkout=canceled`,
        client_reference_id: userId,
        metadata: { userId, planKey },
      },
      { idempotencyKey },
    );

    if (!session.url) {
      throw new Error('Stripe did not return a checkout URL for this session.');
    }
    return { url: session.url };
  }

  /**
   * Stripe's hosted portal for managing/cancelling a subscription and updating a
   * payment method — legally required in most jurisdictions (a subscription must be
   * as easy to cancel as it was to start) and something this API should never
   * reimplement itself: card data, proration, and cancellation timing are all Stripe's
   * problem there, same as checkout.
   */
  async createPortalSession(userId: string): Promise<{ url: string }> {
    const sub = await this.subscriptions.findOne({ where: { userId } });
    if (!sub?.stripeCustomerId) {
      throw new NotFoundException(
        'No billing account on file — you are on the free plan.',
      );
    }

    const session = await this.stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${this.env.get('APP_URL')}/billing`,
    });
    return { url: session.url };
  }

  async getSubscription(
    userId: string,
  ): Promise<{ plan: Plan | null; subscription: Subscription | null }> {
    const subscription = await this.subscriptions.findOne({
      where: { userId },
    });
    const planKey = subscription?.planKey ?? 'free';
    const plan = await this.plans.findOne({ where: { key: planKey } });
    return { plan, subscription };
  }

  /** Existing customer id if we have one on file, else mints one and persists it. */
  private async ensureStripeCustomer(
    userId: string,
    email: string,
  ): Promise<string> {
    const existing = await this.subscriptions.findOne({ where: { userId } });
    if (existing?.stripeCustomerId) return existing.stripeCustomerId;

    const customer = await this.stripe.customers.create({
      email,
      metadata: { userId },
    });

    if (existing) {
      await this.subscriptions.update(existing.id, {
        stripeCustomerId: customer.id,
      });
    } else {
      await this.subscriptions.save(
        this.subscriptions.create({ userId, stripeCustomerId: customer.id }),
      );
    }
    return customer.id;
  }

  /**
   * `rawBody` MUST be the exact bytes Stripe signed — see main.ts's express.raw()
   * carve-out for this one route. Anything that's gone through the global JSON body
   * parser first will fail signature verification even with a correct secret.
   */
  async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.env.get('STRIPE_WEBHOOK_SECRET'),
      );
    } catch (err) {
      throw new AppException(
        ErrorCode.WEBHOOK_SIGNATURE_INVALID,
        'Invalid Stripe webhook signature.',
        { reason: err instanceof Error ? err.message : String(err) },
      );
    }

    // ── IDEMPOTENCY ──
    // Insert-first-then-check-conflict, not exists-then-insert: the latter has a race
    // window where two concurrent deliveries of the same event both pass the exists
    // check before either inserts.
    try {
      await this.webhookEvents.save(
        this.webhookEvents.create({ eventId: event.id, type: event.type }),
      );
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        this.logger.log(
          `webhook ${event.id} (${event.type}) already processed — skipping`,
        );
        return;
      }
      throw err;
    }

    switch (event.type) {
      case 'checkout.session.completed':
        await this.onCheckoutCompleted(event);
        break;
      case 'customer.subscription.updated':
        await this.onSubscriptionUpdated(event);
        break;
      case 'customer.subscription.deleted':
        await this.onSubscriptionDeleted(event);
        break;
      case 'invoice.payment_succeeded':
        await this.onPaymentSucceeded(event);
        break;
      case 'invoice.payment_failed':
        await this.onPaymentFailed(event);
        break;
      default:
        // Every other event type is either irrelevant to us or informational —
        // ignoring it is correct, not a gap.
        break;
    }
  }

  private async onCheckoutCompleted(event: Stripe.Event): Promise<void> {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.client_reference_id ?? session.metadata?.userId;
    const planKey = session.metadata?.planKey as PlanKey | undefined;
    if (!userId || !planKey) {
      this.logger.warn(
        `checkout.session.completed missing userId/planKey (session ${session.id})`,
      );
      return;
    }

    const stripeSubscriptionId =
      typeof session.subscription === 'string'
        ? session.subscription
        : (session.subscription?.id ?? null);
    const stripeCustomerId =
      typeof session.customer === 'string'
        ? session.customer
        : (session.customer?.id ?? null);

    await this.subscriptions.upsert(
      {
        userId,
        stripeCustomerId,
        stripeSubscriptionId,
        planKey,
        status: 'active',
        lastEventAt: new Date(event.created * 1000),
      },
      { conflictPaths: ['userId'] },
    );
  }

  private async onSubscriptionUpdated(event: Stripe.Event): Promise<void> {
    const stripeSub = event.data.object as Stripe.Subscription;
    const sub = await this.subscriptions.findOne({
      where: { stripeSubscriptionId: stripeSub.id },
    });
    if (!sub) {
      this.logger.warn(
        `customer.subscription.updated for unknown subscription ${stripeSub.id}`,
      );
      return;
    }

    // ── OUT-OF-ORDER GUARD ──
    // Stripe does not guarantee delivery order. An update event older than the last
    // one we applied is a stale replay/retry — applying it would un-apply a newer
    // change we already reflected (e.g. a delayed 'active' arriving after a
    // subsequent, newer 'past_due').
    const eventTime = new Date(event.created * 1000);
    if (sub.lastEventAt && eventTime < sub.lastEventAt) {
      this.logger.log(
        `ignoring stale customer.subscription.updated for ${stripeSub.id} (event ${event.created} < last-applied)`,
      );
      return;
    }

    // current_period_end lives on the subscription ITEM in this Stripe API version,
    // not on the subscription object itself.
    const periodEnd = stripeSub.items.data[0]?.current_period_end;

    await this.subscriptions.update(sub.id, {
      status: this.mapStripeStatus(stripeSub.status),
      currentPeriodEnd: periodEnd
        ? new Date(periodEnd * 1000)
        : sub.currentPeriodEnd,
      cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
      lastEventAt: eventTime,
    });
  }

  private async onSubscriptionDeleted(event: Stripe.Event): Promise<void> {
    const stripeSub = event.data.object as Stripe.Subscription;
    const sub = await this.subscriptions.findOne({
      where: { stripeSubscriptionId: stripeSub.id },
    });
    if (!sub) return;

    const eventTime = new Date(event.created * 1000);
    if (sub.lastEventAt && eventTime < sub.lastEventAt) return;

    await this.subscriptions.update(sub.id, {
      planKey: 'free',
      status: 'canceled',
      cancelAtPeriodEnd: false,
      lastEventAt: eventTime,
    });
  }

  private async onPaymentSucceeded(event: Stripe.Event): Promise<void> {
    const invoice = event.data.object as Stripe.Invoice;
    const stripeSubscriptionId = this.subscriptionIdFromInvoice(invoice);
    if (!stripeSubscriptionId) return; // one-off invoice, not a subscription renewal

    const sub = await this.subscriptions.findOne({
      where: { stripeSubscriptionId },
    });
    if (!sub) return;

    const plan = await this.plans.findOne({ where: { key: sub.planKey } });
    if (plan && plan.monthlyCredits > 0) {
      await this.credits.grant(
        sub.userId,
        plan.monthlyCredits,
        'monthly_refill',
        sub.id,
        undefined,
        'subscription',
      );
      await this.subscriptions.update(sub.id, { lastRefillAt: new Date() });
    }

    // A past-due subscription that pays successfully is active again.
    if (sub.status !== 'active') {
      await this.subscriptions.update(sub.id, { status: 'active' });
    }
  }

  private async onPaymentFailed(event: Stripe.Event): Promise<void> {
    const invoice = event.data.object as Stripe.Invoice;
    const stripeSubscriptionId = this.subscriptionIdFromInvoice(invoice);
    if (!stripeSubscriptionId) return;

    const sub = await this.subscriptions.findOne({
      where: { stripeSubscriptionId },
    });
    if (!sub) return;

    await this.subscriptions.update(sub.id, { status: 'past_due' });

    const user = await this.users.findOne({ where: { id: sub.userId } });
    if (user) {
      await this.emails.add('send', {
        to: user.email,
        template: 'payment-failed',
        vars: { url: `${this.env.get('APP_URL')}/billing` },
      });
    }
  }

  /**
   * Safety net for the case a webhook was never delivered (Stripe was down, our
   * endpoint was down, ...) — Stripe's webhook retries eventually give up, so this
   * cron re-derives truth for every non-free subscription directly from the Stripe
   * API rather than waiting for an event that may never arrive.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async reconcileAll(): Promise<{
    checked: number;
    corrected: number;
    refilled: number;
  }> {
    const subs = await this.subscriptions.find({
      where: [{ status: 'active' }, { status: 'past_due' }],
    });

    let corrected = 0;
    let refilled = 0;
    for (const sub of subs) {
      if (!sub.stripeSubscriptionId) continue;
      try {
        const stripeSub = await this.stripe.subscriptions.retrieve(
          sub.stripeSubscriptionId,
        );
        const mappedStatus = this.mapStripeStatus(stripeSub.status);
        const periodEnd = stripeSub.items.data[0]?.current_period_end;
        const periodStart = stripeSub.items.data[0]?.current_period_start;
        const drift =
          mappedStatus !== sub.status ||
          stripeSub.cancel_at_period_end !== sub.cancelAtPeriodEnd;
        if (drift) {
          await this.subscriptions.update(sub.id, {
            status: mappedStatus,
            currentPeriodEnd: periodEnd
              ? new Date(periodEnd * 1000)
              : sub.currentPeriodEnd,
            cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
          });
          corrected++;
        }

        // ── Missed-refill safety net ──
        // The normal path is invoice.payment_succeeded granting this period's
        // credits via webhook. Status drift and credit drift are two DIFFERENT
        // failure modes — a subscription can be perfectly in sync on status while
        // a single missed webhook (an outage on either side) means the user
        // silently never got that period's credits. This catches that case
        // directly rather than relying on the status check above to also imply it.
        if (periodStart) {
          const periodStartDate = new Date(periodStart * 1000);
          const alreadyRefilledThisPeriod =
            sub.lastRefillAt && sub.lastRefillAt >= periodStartDate;
          if (!alreadyRefilledThisPeriod) {
            const plan = await this.plans.findOne({
              where: { key: sub.planKey },
            });
            if (plan && plan.monthlyCredits > 0) {
              await this.credits.grant(
                sub.userId,
                plan.monthlyCredits,
                'monthly_refill',
                sub.id,
                undefined,
                'subscription',
              );
              await this.subscriptions.update(sub.id, {
                lastRefillAt: periodStartDate,
              });
              refilled++;
              this.logger.warn(
                `granted a missed monthly refill for subscription ${sub.id} (period starting ${periodStartDate.toISOString()})`,
              );
            }
          }
        }
      } catch (err) {
        this.logger.error(
          `reconciliation failed for subscription ${sub.stripeSubscriptionId}`,
          err as Error,
        );
      }
    }
    return { checked: subs.length, corrected, refilled };
  }

  private subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
    // Invoice.subscription was removed in favor of parent.subscription_details in
    // recent Stripe API versions; fall back to the older shape defensively since
    // Stripe's webhook payload shape is pinned to whatever version signed it, which
    // may predate this account's configured default.
    const legacy = (
      invoice as unknown as { subscription?: string | { id: string } }
    ).subscription;
    if (legacy) return typeof legacy === 'string' ? legacy : legacy.id;
    return invoice.parent?.subscription_details?.subscription
      ? typeof invoice.parent.subscription_details.subscription === 'string'
        ? invoice.parent.subscription_details.subscription
        : invoice.parent.subscription_details.subscription.id
      : null;
  }

  private mapStripeStatus(
    status: Stripe.Subscription.Status,
  ): SubscriptionStatus {
    switch (status) {
      case 'active':
      case 'trialing':
        return 'active';
      case 'past_due':
      case 'unpaid':
        return 'past_due';
      case 'canceled':
      case 'incomplete_expired':
        return 'canceled';
      default:
        return 'incomplete';
    }
  }
}
