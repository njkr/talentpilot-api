import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
// See payments.service.ts for why this is `import X = require()`, not a default import.
import Stripe = require('stripe');
import { Env } from '../../config/config.module';
import { Plan } from '../entities/plan.entity';
import { CreditPack } from '../entities/credit-pack.entity';
import { IntegrationCallRecorderService } from '../../integration-calls/integration-call-recorder.service';
import { attachStripeUsageTracking } from '../../integration-calls/stripe-usage-tracking.util';

const STRIPE_API_VERSION = '2026-06-24.dahlia' as const;

/**
 * ⚠️ The one rule everything here is built around: a Stripe Price is IMMUTABLE. You
 * cannot change the amount of an existing Price. So "admin edits the Pro monthly
 * price" does NOT update a Stripe object — it creates a NEW Price, points the plan at
 * it, and archives the old one. Existing subscribers stay on the price they signed up
 * at (correct, and the only legally safe option — you cannot unilaterally raise
 * someone's rate); only new checkouts use the new price. Fighting this produces either
 * a Stripe API error (prices.update rejects unit_amount) or, if done wrong at a higher
 * level, silent mass re-pricing of every active subscriber.
 */
@Injectable()
export class StripeSyncService {
  private readonly logger = new Logger(StripeSyncService.name);
  private readonly stripe: Stripe;

  constructor(
    env: Env,
    @InjectRepository(Plan) private readonly plans: Repository<Plan>,
    @InjectRepository(CreditPack)
    private readonly packs: Repository<CreditPack>,
    private readonly integrationCalls: IntegrationCallRecorderService,
  ) {
    this.stripe = new Stripe(env.get('STRIPE_SECRET_KEY'), {
      apiVersion: STRIPE_API_VERSION,
    });
    attachStripeUsageTracking(this.stripe, this.integrationCalls);
  }

  /**
   * Called when admin creates or edits a plan. Idempotent and immutability-safe:
   *  - product: created once, then updated in place (products ARE mutable — name/description).
   *  - price: NEVER mutated. If the amount changed, create a NEW price, repoint the
   *           plan, and archive the OLD price so it's hidden from new checkouts but
   *           existing subscriptions keep billing at their locked-in price.
   */
  async syncPlan(plan: Plan): Promise<Plan> {
    // ── 1. Product (mutable) ──
    if (!plan.stripeProductId) {
      const product = await this.stripe.products.create({
        name: plan.name,
        description: plan.description ?? undefined,
        metadata: { planKey: plan.key, planId: plan.id },
      });
      plan.stripeProductId = product.id;
    } else {
      await this.stripe.products.update(plan.stripeProductId, {
        name: plan.name,
        description: plan.description ?? undefined,
        active: plan.active,
      });
    }

    // ── 2. Prices (immutable — create-new-and-archive-old) ──
    plan.stripePriceIds = {
      monthly: await this.ensurePrice(
        plan,
        'month',
        plan.priceMonthlyCents,
        plan.stripePriceIds?.monthly,
      ),
      yearly: await this.ensurePrice(
        plan,
        'year',
        plan.priceYearlyCents,
        plan.stripePriceIds?.yearly,
      ),
    };

    return this.plans.save(plan);
  }

  /**
   * Ensures a Stripe Price exists for (product, interval, amount). Returns its id (or
   * '' for a free/zero-amount tier, which has no Stripe price at all).
   */
  private async ensurePrice(
    plan: Plan,
    interval: 'month' | 'year',
    amountCents: number,
    currentPriceId?: string,
  ): Promise<string> {
    if (amountCents <= 0) return ''; // free plan, or this plan has no yearly option

    // Is the current price already correct? Check its amount before recreating.
    if (currentPriceId) {
      try {
        const existing = await this.stripe.prices.retrieve(currentPriceId);
        if (existing.unit_amount === amountCents && existing.active) {
          return currentPriceId;
        }
      } catch {
        /* price vanished (deleted in the Stripe dashboard) — fall through and recreate */
      }
    }

    // Amount changed (or no price yet) → create a NEW price.
    const price = await this.stripe.prices.create({
      product: plan.stripeProductId!,
      unit_amount: amountCents,
      currency: 'usd',
      recurring: { interval },
      metadata: { planKey: plan.key },
    });

    // Archive the old price so it won't appear in new Checkout sessions. Existing
    // subscriptions referencing it KEEP billing normally — archiving is not deleting,
    // and Stripe honors already-active subscriptions on an archived price.
    if (currentPriceId && currentPriceId !== price.id) {
      await this.stripe.prices
        .update(currentPriceId, { active: false })
        .catch(() => {});
      this.logger.log(
        `plan ${plan.key}: price changed (${interval}) — new ${price.id} created, ` +
          `old ${currentPriceId} archived; existing subscribers unaffected`,
      );
    }

    return price.id;
  }

  /** Archive a plan entirely (admin "delete"). Never hard-delete — existing subs must keep working. */
  async archivePlan(plan: Plan): Promise<Plan> {
    if (plan.stripeProductId) {
      await this.stripe.products.update(plan.stripeProductId, {
        active: false,
      });
    }
    for (const priceId of Object.values(plan.stripePriceIds ?? {})) {
      if (priceId) {
        await this.stripe.prices
          .update(priceId, { active: false })
          .catch(() => {});
      }
    }
    plan.active = false;
    return this.plans.save(plan);
  }

  /** Same immutable-price rule as syncPlan, but a ONE-TIME price (no `recurring`). */
  async syncCreditPack(pack: CreditPack): Promise<CreditPack> {
    if (!pack.stripeProductId) {
      const product = await this.stripe.products.create({
        name: pack.name,
        description: pack.description ?? undefined,
        metadata: { creditPackId: pack.id, credits: String(pack.credits) },
      });
      pack.stripeProductId = product.id;
    } else {
      await this.stripe.products.update(pack.stripeProductId, {
        name: pack.name,
        description: pack.description ?? undefined,
        active: pack.active,
      });
    }

    const needsNew =
      !pack.stripePriceId ||
      !(await this.priceMatches(pack.stripePriceId, pack.priceCents));
    if (needsNew) {
      const price = await this.stripe.prices.create({
        product: pack.stripeProductId,
        unit_amount: pack.priceCents,
        currency: 'usd',
        metadata: { creditPackId: pack.id, credits: String(pack.credits) },
        // no `recurring` → this is a one-time price
      });
      if (pack.stripePriceId) {
        await this.stripe.prices
          .update(pack.stripePriceId, { active: false })
          .catch(() => {});
      }
      pack.stripePriceId = price.id;
    }
    return this.packs.save(pack);
  }

  /** Archive a credit pack entirely (admin "delete"). */
  async archiveCreditPack(pack: CreditPack): Promise<CreditPack> {
    if (pack.stripeProductId) {
      await this.stripe.products.update(pack.stripeProductId, {
        active: false,
      });
    }
    if (pack.stripePriceId) {
      await this.stripe.prices
        .update(pack.stripePriceId, { active: false })
        .catch(() => {});
    }
    pack.active = false;
    return this.packs.save(pack);
  }

  private async priceMatches(
    priceId: string,
    amountCents: number,
  ): Promise<boolean> {
    try {
      const existing = await this.stripe.prices.retrieve(priceId);
      return existing.unit_amount === amountCents && existing.active;
    } catch {
      return false;
    }
  }
}
