import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ReferralsService } from './referrals.service';
import { User } from '../auth/entities/user.entity';

/**
 * Event-driven, same reasoning as CreditsListener's signup bonus: AuthService must
 * not know referrals exist, and a referral-recording bug must never fail registration
 * or block a pipeline run finishing. Both handlers below are wrapped in try/catch for
 * exactly that reason.
 */
@Injectable()
export class ReferralsListener {
  private readonly logger = new Logger(ReferralsListener.name);

  constructor(private readonly referrals: ReferralsService) {}

  @OnEvent('user.registered')
  async onRegistered({
    user,
    referralCode,
  }: {
    user: User;
    referralCode?: string;
  }) {
    if (!referralCode) return;
    try {
      await this.referrals.recordSignup(user.id, user.email, referralCode);
      // If the admin has configured 'signup' as the qualifying event (accepting the
      // higher abuse risk that entails — see checkQualification()'s doc comment),
      // this is the one qualifying event that can fire in the SAME handler as the
      // signup itself, since recordSignup() has just created the referral row.
      await this.referrals.checkQualification(user.id, 'signup');
    } catch (err) {
      this.logger.error(
        `referral signup recording failed for user ${user.id}`,
        err as Error,
      );
    }
  }

  @OnEvent('user.verified')
  async onVerified({ user }: { user: User }) {
    try {
      await this.referrals.checkQualification(user.id, 'email_verified');
    } catch (err) {
      this.logger.warn(
        `referral qualification check failed for user ${user.id}`,
        err as Error,
      );
    }
  }

  // NOTE: 'first_payment' (the fourth PaymentConfig.referralQualifyingEvent option) has
  // no listener yet — PaymentsService doesn't currently emit a domain event on a
  // successful checkout/invoice the way auth and the pipeline do. An admin who selects
  // it will see referrals sit in 'signed_up' forever. Wiring it up means emitting an
  // event from PaymentsService.onCheckoutCompleted()/onPaymentSucceeded() and adding a
  // handler here — deliberately left out of this sprint's scope; flagged rather than
  // silently half-supported.
  @OnEvent('run.completed')
  async onRunCompleted({ userId }: { userId: string }) {
    // Fire-and-forget — a referral bug must never affect the pipeline result.
    try {
      await this.referrals.checkQualification(userId, 'first_analysis');
    } catch (err) {
      this.logger.warn(
        `referral qualification check failed for user ${userId}`,
        err as Error,
      );
    }
  }
}
