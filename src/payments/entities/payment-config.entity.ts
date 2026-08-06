import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export type ReferralQualifyingEvent =
  | 'signup'
  | 'email_verified'
  | 'first_analysis'
  | 'first_payment';

/**
 * A SINGLETON row (id enforced = 1 by a CHECK constraint — see the migration). Holds
 * every tunable payment/credit number an admin can change live, so a price or cost
 * change doesn't need a deploy. Read through PaymentConfigService's cached getter —
 * this table is queried on every credit debit, so it must never be a per-request hit.
 */
@Entity('payment_config')
export class PaymentConfig {
  @PrimaryColumn({ type: 'int', default: 1 })
  id: number;

  // ── signup & referral grants ──
  @Column({ name: 'signup_credit_grant', type: 'int', default: 25 })
  signupCreditGrant: number;

  @Column({ name: 'referrer_reward', type: 'int', default: 50 })
  referrerReward: number; // credits the inviter earns

  @Column({ name: 'referee_reward', type: 'int', default: 25 })
  refereeReward: number; // bonus credits the invited user earns

  @Column({
    name: 'referral_qualifying_event',
    type: 'varchar',
    default: 'first_analysis',
  })
  referralQualifyingEvent: ReferralQualifyingEvent;

  @Column({ name: 'max_referral_rewards_per_user', type: 'int', default: 20 })
  maxReferralRewardsPerUser: number; // anti-abuse cap

  // ── action costs (were env/code constants) ──
  @Column({ name: 'analyze_cost', type: 'int', default: 21 })
  analyzeCost: number;
  @Column({ name: 'cover_letter_regen_cost', type: 'int', default: 2 })
  coverLetterRegenCost: number;
  @Column({ name: 'interview_feedback_cost', type: 'int', default: 1 })
  interviewFeedbackCost: number;
  // Re-scores the CURRENT resume version against the same JD after suggestions have
  // been applied — genuinely new AI work (a fresh embedding + the ats_grading
  // completion), not bundled into analyzeCost, which is charged once up front before
  // any suggestions exist. Default mirrors generate_embeddings+match_keywords+
  // score_ats's combined STEP_MANIFEST weight (1+2+2=5).
  @Column({ name: 'rescore_cost', type: 'int', default: 5 })
  rescoreCost: number;

  // ── feature flags ──
  @Column({ name: 'referrals_enabled', default: true })
  referralsEnabled: boolean;
  @Column({ name: 'credit_packs_enabled', default: true })
  creditPacksEnabled: boolean;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy: string | null; // which admin last changed it (audit)
}
