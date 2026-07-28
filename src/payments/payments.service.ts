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
import { In, Repository } from 'typeorm';
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
import { AuditService } from '../audit/audit.service';
import { AppException, ErrorCode } from '../common/exceptions/app.exception';
import { Problems } from '../common/problems';
import { IntegrationCallRecorderService } from '../integration-calls/integration-call-recorder.service';
import { attachStripeUsageTracking } from '../integration-calls/stripe-usage-tracking.util';

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
    private readonly audit: AuditService,
    @InjectQueue('emails') private readonly emails: Queue,
    private readonly integrationCalls: IntegrationCallRecorderService,
  ) {
    this.stripe = new Stripe(this.env.get('STRIPE_SECRET_KEY'), {
      apiVersion: STRIPE_API_VERSION,
    });
    attachStripeUsageTracking(this.stripe, this.integrationCalls);
  }

  async createCheckoutSession(
    userId: string,
    planKey: PlanKey,
    idempotencyKey?: string,
    interval: 'month' | 'year' = 'month',
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

    // The classic double-subscription bug: an existing subscriber hitting checkout
    // again creates a SECOND Stripe subscription (and a second charge) instead of
    // changing their existing one. Route them to /subscription/switch instead.
    // Gated on a REAL stripeSubscriptionId, not just planKey !== 'free': a row can
    // exist with only a stripeCustomerId (ensureStripeCustomer ran once, e.g. from an
    // abandoned checkout) with no subscription ever actually started — that user has
    // genuinely never subscribed and must still be allowed through.
    const existingSub = await this.subscriptions.findOne({
      where: { userId, status: In(['active', 'past_due']) },
    });
    if (existingSub?.stripeSubscriptionId) {
      throw Problems.alreadySubscribed();
    }

    const plan = await this.plans.findOne({
      where: { key: planKey, active: true },
    });
    const priceId =
      interval === 'year'
        ? plan?.stripePriceIds?.yearly
        : plan?.stripePriceIds?.monthly;
    if (!priceId) {
      throw new NotFoundException(
        `Plan "${planKey}" (${interval}ly) is not available for checkout.`,
      );
    }

    const user = await this.users.findOneOrFail({ where: { id: userId } });
    const customerId = await this.ensureStripeCustomer(userId, user.email);

    const session = await this.stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
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

  /**
   * Schedules cancellation at the end of the current billing period. The user keeps
   * their plan and benefits until currentPeriodEnd, then drops to free (via the
   * customer.subscription.deleted webhook — onSubscriptionDeleted()). NEVER cancel
   * immediately: they paid for the period, they get the period; an immediate cancel
   * is a refund question, not a cancel one.
   */
  async cancelSubscription(userId: string): Promise<Subscription> {
    const sub = await this.subscriptions.findOne({
      where: { userId, status: In(['active', 'past_due']) },
    });
    if (!sub || !sub.stripeSubscriptionId)
      throw Problems.noActiveSubscription();

    let updated: Stripe.Subscription;
    try {
      // A pending downgrade attaches a Stripe Subscription Schedule to this
      // subscription, and Stripe rejects `cancel_at_period_end` on a
      // schedule-controlled subscription. Cancelling supersedes any scheduled
      // change anyway (there's no plan to switch to once the sub is ending), so
      // release the schedule first — this is what used to 500 here.
      await this.releaseScheduleIfAny(sub.stripeSubscriptionId);
      updated = await this.stripe.subscriptions.update(
        sub.stripeSubscriptionId,
        { cancel_at_period_end: true },
      );
    } catch (err) {
      this.logger.error(
        `cancelSubscription failed for user ${userId} (sub ${sub.id})`,
        err as Error,
      );
      throw Problems.subscriptionUpdateFailed();
    }

    // Mirror Stripe's decision locally now rather than waiting for the webhook, so
    // the API reflects it in the same response. current_period_end lives on the
    // subscription ITEM in this API version, not the subscription object itself
    // (see onSubscriptionUpdated()'s own comment on the same quirk).
    const periodEnd = updated.items.data[0]?.current_period_end;
    sub.cancelAtPeriodEnd = true;
    sub.pendingPlanKey = null; // cancelling makes any pending downgrade moot
    if (periodEnd) sub.currentPeriodEnd = new Date(periodEnd * 1000);
    await this.subscriptions.save(sub);

    await this.audit.log({
      userId,
      actorType: 'user',
      action: 'subscription.cancel_scheduled',
      resourceType: 'subscription',
      resourceId: sub.id,
      metadata: { endsAt: sub.currentPeriodEnd },
    });
    return sub;
  }

  /** Undo a scheduled cancellation — a one-call fix for "I changed my mind", no re-subscribe needed. */
  async resumeSubscription(userId: string): Promise<Subscription> {
    const sub = await this.subscriptions.findOne({
      where: { userId, cancelAtPeriodEnd: true },
    });
    if (!sub || !sub.stripeSubscriptionId)
      throw Problems.noSubscriptionToResume();

    await this.stripe.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: false,
    });
    sub.cancelAtPeriodEnd = false;
    await this.subscriptions.save(sub);

    await this.audit.log({
      userId,
      actorType: 'user',
      action: 'subscription.cancel_reverted',
      resourceType: 'subscription',
      resourceId: sub.id,
    });
    return sub;
  }

  /**
   * Switches an EXISTING subscriber to a different plan. One subscription, the price
   * line swapped — never cancel-and-recreate, which would either double-charge (two
   * active subscriptions) or leave a coverage gap. Callers must route existing
   * subscribers here, never back through createCheckoutSession() (which now rejects
   * them — see the ALREADY_SUBSCRIBED guard above).
   *
   * Upgrade vs downgrade get different treatment, and it's a product decision, not a
   * technical default:
   *  - UPGRADE: applied immediately (`always_invoice` prorates the difference onto an
   *    invoice now). Most users clicking "upgrade" expect the better plan right away,
   *    not at next renewal. The credit-allotment GAP between the two plans is granted
   *    immediately too, so the upgrade feels instant rather than waiting for the next
   *    monthly_refill.
   *  - DOWNGRADE: deferred to the next renewal via a Stripe Subscription Schedule, so
   *    the user keeps the HIGHER plan's benefits (already paid for) until the period
   *    ends, then Stripe itself flips the price. `pendingPlanKey` records this so the
   *    UI can say "Changes to Pro on <date>"; onSubscriptionUpdated() clears it and
   *    finalizes `planKey` once Stripe's own webhook confirms the phase actually
   *    changed — no cron/polling needed.
   */
  async switchPlan(
    userId: string,
    targetPlanKey: PlanKey,
    interval: 'month' | 'year' = 'month',
  ): Promise<Subscription> {
    const sub = await this.subscriptions.findOne({
      where: { userId, status: In(['active', 'past_due']) },
    });
    if (!sub || !sub.stripeSubscriptionId)
      throw Problems.noActiveSubscription();

    if (sub.planKey === targetPlanKey) {
      // "Switch back to the plan I'm already on" while a downgrade is pending is a
      // legitimate undo request, not a no-op — the old unconditional throw here left
      // no path to release the schedule short of finishing the downgrade for real
      // (see clearPendingChange()'s own doc comment).
      if (sub.pendingPlanKey) return this.clearPendingChange(userId);
      throw Problems.alreadyOnPlan(targetPlanKey);
    }

    const target = await this.plans.findOne({
      where: { key: targetPlanKey, active: true },
    });
    const newPriceId =
      interval === 'year'
        ? target?.stripePriceIds?.yearly
        : target?.stripePriceIds?.monthly;
    if (!target || !newPriceId)
      throw Problems.planNotPurchasable(targetPlanKey);

    const currentPlan = await this.plans.findOne({
      where: { key: sub.planKey },
    });
    const isUpgrade =
      target.priceMonthlyCents > (currentPlan?.priceMonthlyCents ?? 0);

    const stripeSub = await this.stripe.subscriptions.retrieve(
      sub.stripeSubscriptionId,
    );
    const currentItemId = stripeSub.items.data[0]?.id;
    if (!currentItemId) {
      throw new Error(
        `Stripe subscription ${sub.stripeSubscriptionId} has no price item to switch.`,
      );
    }

    if (isUpgrade) {
      // If a downgrade was previously scheduled, release that schedule first —
      // making an ad-hoc change to a subscription that's under an active Schedule's
      // control is unsupported/surprising in Stripe; releasing hands control back to
      // the subscription itself before we touch it directly.
      await this.releaseScheduleIfAny(sub.stripeSubscriptionId);

      const updated = await this.stripe.subscriptions.update(
        sub.stripeSubscriptionId,
        {
          items: [{ id: currentItemId, price: newPriceId }],
          proration_behavior: 'always_invoice',
        },
      );
      return this.applyUpgrade(sub, target, currentPlan, updated);
    }

    // Downgrade: don't touch the subscription's active price at all right now — a
    // direct subscriptions.update({items: [...]}) call changes the underlying price
    // object IMMEDIATELY regardless of proration_behavior (that setting only controls
    // the invoice math, not timing), which would drop the user to the lower plan's
    // benefits mid-cycle. A Subscription Schedule is the correct "apply later"
    // mechanism: it keeps the CURRENT price active through period end, then switches.
    await this.scheduleDowngrade(stripeSub, newPriceId);
    sub.pendingPlanKey = target.key;
    await this.subscriptions.save(sub);

    await this.audit.log({
      userId,
      actorType: 'user',
      action: 'subscription.downgrade_scheduled',
      resourceType: 'subscription',
      resourceId: sub.id,
      metadata: { to: target.key, effectiveAt: sub.currentPeriodEnd },
    });
    return sub;
  }

  /**
   * Cancels a pending plan change (a scheduled downgrade), returning the subscription
   * to its current plan with nothing scheduled. This is the explicit undo path for a
   * downgrade — switchPlan() also routes here when the caller "switches" to the plan
   * they're already on while one is pending, since that's the same request phrased
   * differently.
   */
  async clearPendingChange(userId: string): Promise<Subscription> {
    const sub = await this.subscriptions.findOne({
      where: { userId, status: In(['active', 'past_due']) },
    });
    if (!sub || !sub.stripeSubscriptionId)
      throw Problems.noActiveSubscription();
    if (!sub.pendingPlanKey) throw Problems.noPendingChange();

    try {
      await this.releaseScheduleIfAny(sub.stripeSubscriptionId);
    } catch (err) {
      this.logger.error(
        `clearPendingChange failed for user ${userId} (sub ${sub.id})`,
        err as Error,
      );
      throw Problems.subscriptionUpdateFailed();
    }

    sub.pendingPlanKey = null;
    await this.subscriptions.save(sub);

    await this.audit.log({
      userId,
      actorType: 'user',
      action: 'subscription.pending_change_cleared',
      resourceType: 'subscription',
      resourceId: sub.id,
    });
    return sub;
  }

  private async applyUpgrade(
    sub: Subscription,
    target: Plan,
    currentPlan: Plan | null,
    stripeSub: Stripe.Subscription,
  ): Promise<Subscription> {
    const gap = target.monthlyCredits - (currentPlan?.monthlyCredits ?? 0);

    sub.planKey = target.key;
    sub.pendingPlanKey = null;
    const periodEnd = stripeSub.items.data[0]?.current_period_end;
    if (periodEnd) sub.currentPeriodEnd = new Date(periodEnd * 1000);
    await this.subscriptions.save(sub);

    // Top up the credit-allotment GAP between the two plans (not the new plan's full
    // allotment — that would double-grant on top of whatever this period already
    // received) so the upgrade feels immediate rather than waiting for next refill.
    if (gap > 0) {
      await this.credits.grant(
        sub.userId,
        gap,
        'plan_upgrade',
        sub.id,
        undefined,
        'subscription',
      );
    }

    await this.audit.log({
      userId: sub.userId,
      actorType: 'user',
      action: 'subscription.upgraded',
      resourceType: 'subscription',
      resourceId: sub.id,
      metadata: { to: target.key, creditsGranted: Math.max(gap, 0) },
    });
    return sub;
  }

  /**
   * Keeps the CURRENT price active through the current period, then switches to
   * newPriceId at the next renewal — via a Stripe Subscription Schedule, the
   * mechanism built for exactly this ("apply this change later"), rather than an
   * immediate items update with proration suppressed (which changes the price NOW,
   * just without an invoice line for it — timing and billing are separate knobs).
   */
  private async scheduleDowngrade(
    stripeSub: Stripe.Subscription,
    newPriceId: string,
  ): Promise<void> {
    const currentItem = stripeSub.items.data[0];
    const periodStart = currentItem.current_period_start;
    const periodEnd = currentItem.current_period_end;

    let scheduleId =
      typeof stripeSub.schedule === 'string'
        ? stripeSub.schedule
        : stripeSub.schedule?.id;
    if (!scheduleId) {
      const schedule = await this.stripe.subscriptionSchedules.create({
        from_subscription: stripeSub.id,
      });
      scheduleId = schedule.id;
    }

    await this.stripe.subscriptionSchedules.update(scheduleId, {
      end_behavior: 'release', // after phase 2, hand control back to a normal subscription
      phases: [
        {
          items: [
            {
              price:
                typeof currentItem.price === 'string'
                  ? currentItem.price
                  : currentItem.price.id,
              quantity: currentItem.quantity ?? 1,
            },
          ],
          start_date: periodStart,
          end_date: periodEnd,
        },
        {
          items: [{ price: newPriceId, quantity: 1 }],
          start_date: periodEnd,
        },
      ],
      proration_behavior: 'none',
    });
  }

  /**
   * Releases any active Stripe Subscription Schedule on this subscription, returning
   * it to a plain subscription billing at its CURRENT price. This is what "undo a
   * pending downgrade" actually is at the Stripe level: releasing drops the scheduled
   * future change but leaves the subscription itself running, unchanged, for the rest
   * of the period.
   *
   * `release`, not `cancel` — `subscriptionSchedules.cancel()` cancels the
   * SUBSCRIPTION underneath it, which is not what any caller here wants.
   *
   * Idempotent: no schedule (or one Stripe already released) is a no-op, not an
   * error, so cancel/switch/clearPendingChange can all call this unconditionally
   * before doing their own thing — this is the ONE place that knows how.
   */
  private async releaseScheduleIfAny(
    stripeSubscriptionId: string,
  ): Promise<void> {
    const stripeSub =
      await this.stripe.subscriptions.retrieve(stripeSubscriptionId);
    const scheduleId =
      typeof stripeSub.schedule === 'string'
        ? stripeSub.schedule
        : stripeSub.schedule?.id;
    if (!scheduleId) return;

    try {
      await this.stripe.subscriptionSchedules.release(scheduleId);
    } catch (err) {
      // A schedule that's already released/completed throws — that's the outcome we
      // wanted anyway, so treat it as success rather than letting it become a 502.
      const alreadyReleased =
        err instanceof Error &&
        /already.*(released|complet)/i.test(err.message);
      if (!alreadyReleased) throw err;
    }
  }

  /** Reverse lookup: which plan key does this Stripe price id belong to (either interval)? */
  private async planKeyForPrice(priceId: string): Promise<string | null> {
    const plans = await this.plans.find();
    const match = plans.find(
      (p) =>
        p.stripePriceIds?.monthly === priceId ||
        p.stripePriceIds?.yearly === priceId,
    );
    return match?.key ?? null;
  }

  /**
   * Existing customer id if we have one on file, else mints one and persists it.
   * Public: CreditPacksService reuses this rather than minting its own Stripe
   * customer, which would risk creating a second, duplicate Stripe customer for a
   * user who already has one from a subscription checkout.
   */
  async ensureStripeCustomer(userId: string, email: string): Promise<string> {
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

    // A credit-pack purchase is `mode: 'payment'`, not a subscription — branch before
    // the subscription-only fields below are ever read (session.subscription is
    // always null for a one-time payment, which would otherwise look like a bug).
    if (session.metadata?.type === 'credit_pack') {
      await this.onCreditPackPurchased(session);
      return;
    }

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

  /**
   * Idempotency for this grant does NOT need its own check here — handleWebhook()
   * already inserted a row into webhook_events keyed by event.id BEFORE the switch
   * ran, and throws away (via isDuplicateKeyError) any redelivery of the same event
   * before it ever reaches this method. A second, ledger-based idempotency check
   * would also need a real Stripe object id in CreditLedger.referenceId, which is a
   * uuid column — session.id ('cs_...') doesn't fit it anyway, so this relies
   * entirely on the event-level dedup, which is already sufficient.
   */
  private async onCreditPackPurchased(
    session: Stripe.Checkout.Session,
  ): Promise<void> {
    const { userId, packId, credits } = session.metadata!;
    if (!userId || !packId || !credits) {
      this.logger.warn(
        `credit_pack checkout.session.completed missing metadata (session ${session.id})`,
      );
      return;
    }
    await this.credits.grant(
      userId,
      Number(credits),
      'purchase',
      packId,
      undefined,
      'credit_pack',
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
    const currentItem = stripeSub.items.data[0];
    const periodEnd = currentItem?.current_period_end;

    const patch: Partial<Subscription> = {
      status: this.mapStripeStatus(stripeSub.status),
      currentPeriodEnd: periodEnd
        ? new Date(periodEnd * 1000)
        : sub.currentPeriodEnd,
      cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
      lastEventAt: eventTime,
    };

    // A pending downgrade finalizes the moment Stripe's own Subscription Schedule
    // flips the price at the period boundary — this is what turns pendingPlanKey
    // into the real planKey, with no cron/polling needed. An immediate upgrade
    // already set planKey itself (switchPlan()/applyUpgrade()), so this branch only
    // ever fires for the deferred-downgrade path.
    const priceId =
      typeof currentItem?.price === 'string'
        ? currentItem.price
        : currentItem?.price?.id;
    if (priceId && sub.pendingPlanKey) {
      const resolvedKey = await this.planKeyForPrice(priceId);
      if (resolvedKey === sub.pendingPlanKey) {
        patch.planKey = sub.pendingPlanKey;
        patch.pendingPlanKey = null;
      }
    }

    await this.subscriptions.update(sub.id, patch);
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

    // ⚠️ billing_reason === 'subscription_update' is the PRORATION invoice
    // switchPlan()'s immediate upgrade itself creates (proration_behavior:
    // 'always_invoice') — NOT a genuine renewal. Granting a full monthly_refill for
    // it on top of applyUpgrade()'s own credit-gap grant double-pays the user for the
    // same period (found live: upgrading Pro→Ultimate mid-cycle correctly granted the
    // 800-credit gap, then this handler ALSO granted a full 1000-credit refill for the
    // very same proration invoice — 1800 credits for one period instead of 1000).
    // Every other billing_reason ('subscription_cycle' = a real renewal,
    // 'subscription_create' = the very first invoice, undefined = old test fixtures)
    // still grants normally.
    if (invoice.billing_reason === 'subscription_update') return;

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
