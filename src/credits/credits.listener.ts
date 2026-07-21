import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Env } from '../config/config.module';
import { CreditService } from './credit.service';

@Injectable()
export class CreditsListener {
  private readonly logger = new Logger(CreditsListener.name);

  constructor(
    private readonly credits: CreditService,
    private readonly env: Env,
  ) {}

  @OnEvent('user.registered')
  async onRegistered({ user }: any) {
    try {
      await this.credits.grant(
        user.id,
        this.env.get('SIGNUP_CREDIT_GRANT'),
        'signup_bonus',
      );
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
