import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CreditService } from './credit.service';
import { PaymentConfigService } from '../payments/config/payment-config.service';

@Injectable()
export class CreditsListener {
  private readonly logger = new Logger(CreditsListener.name);

  constructor(
    private readonly credits: CreditService,
    private readonly paymentConfig: PaymentConfigService,
  ) {}

  @OnEvent('user.registered')
  async onRegistered({ user }: any) {
    try {
      const { signupCreditGrant } = await this.paymentConfig.get();
      await this.credits.grant(user.id, signupCreditGrant, 'signup_bonus');
    } catch (err) {
      // A failed signup bonus must never fail registration itself — worst case the
      // user has 0 credits and support grants them manually.
      this.logger.error(
        `signup credit grant failed for user ${user.id}`,
        err as Error,
      );
    }
  }
}
