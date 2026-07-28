import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
// See payments.service.ts for why this is `import X = require()`, not a default import.
import Stripe = require('stripe');
import { Env } from '../config/config.module';
import { CreditPack } from './entities/credit-pack.entity';
import { PaymentConfigService } from './config/payment-config.service';
import { PaymentsService } from './payments.service';
import { Problems } from '../common/problems';
import { IntegrationCallRecorderService } from '../integration-calls/integration-call-recorder.service';
import { attachStripeUsageTracking } from '../integration-calls/stripe-usage-tracking.util';

const STRIPE_API_VERSION = '2026-06-24.dahlia' as const;

@Injectable()
export class CreditPacksService {
  private readonly stripe: Stripe;

  constructor(
    private readonly env: Env,
    @InjectRepository(CreditPack)
    private readonly packs: Repository<CreditPack>,
    private readonly config: PaymentConfigService,
    // Reused for ensureStripeCustomer() rather than minting our own Stripe customer —
    // see that method's doc comment on PaymentsService for why.
    private readonly payments: PaymentsService,
    private readonly integrationCalls: IntegrationCallRecorderService,
  ) {
    this.stripe = new Stripe(env.get('STRIPE_SECRET_KEY'), {
      apiVersion: STRIPE_API_VERSION,
    });
    attachStripeUsageTracking(this.stripe, this.integrationCalls);
  }

  async listActive(): Promise<CreditPack[]> {
    return this.packs.find({
      where: { active: true },
      order: { displayOrder: 'ASC' },
    });
  }

  async createCheckout(
    userId: string,
    userEmail: string,
    packId: string,
    idempotencyKey?: string,
  ): Promise<{ url: string }> {
    if (!idempotencyKey) throw Problems.idempotencyKeyRequired();

    const paymentConfig = await this.config.get();
    if (!paymentConfig.creditPacksEnabled) {
      throw Problems.featureDisabled('credit_packs');
    }

    const pack = await this.packs.findOne({
      where: { id: packId, active: true },
    });
    if (!pack?.stripePriceId) {
      throw new NotFoundException(
        `Credit pack "${packId}" is not available for purchase.`,
      );
    }

    const customerId = await this.payments.ensureStripeCustomer(
      userId,
      userEmail,
    );

    const session = await this.stripe.checkout.sessions.create(
      {
        customer: customerId,
        mode: 'payment', // one-time, NOT subscription
        line_items: [{ price: pack.stripePriceId, quantity: 1 }],
        success_url: `${this.env.get('APP_URL')}/billing?purchase=success`,
        cancel_url: `${this.env.get('APP_URL')}/billing`,
        client_reference_id: userId,
        // metadata drives PaymentsService.onCreditPackPurchased(), the webhook
        // handler that actually grants the credits.
        metadata: {
          type: 'credit_pack',
          userId,
          packId: pack.id,
          credits: String(pack.credits),
        },
      },
      { idempotencyKey },
    );

    if (!session.url) {
      throw new Error('Stripe did not return a checkout URL for this session.');
    }
    return { url: session.url };
  }
}
