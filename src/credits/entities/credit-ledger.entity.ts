import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type CreditReason =
  | 'signup_bonus'
  | 'analyze'
  | 'refund'
  | 'grant'
  | 'cover_letter_regenerate'
  | 'answer_feedback'
  // ── Sprint 10: payments ──
  | 'monthly_refill' // granted on invoice.payment_succeeded for a paid plan
  | 'purchase' // one-off credit top-up (not plan-linked)
  | 'admin_adjust' // manual correction via the admin panel (Sprint 11)
  // A prior attempt on this run was proportionally refunded, then a retry delivered
  // the complete product — this reverses that earlier refund. See
  // StepRunner.finalise()/reverseRefund().
  | 'retry_reversal'
  // ── Sprint 13: credit packs & referrals ──
  | 'referral_reward' // the inviter's cut, granted on the referee's qualifying event
  | 'referral_bonus' // the invited user's own bonus, granted at the same time
  // ── Sprint 14: cancellation & plan switching ──
  | 'plan_upgrade'; // the credit-allotment gap granted on an immediate upgrade (see switchPlan())

/**
 * An append-only ledger, not a mutable balance column. Balance is always
 * SUM(amount) for a user — this makes every credit/debit self-auditing (you can
 * always answer "why does this user have 47 credits") and race-safe under
 * concurrent writes in a way a single UPDATE ... SET balance = balance - n isn't
 * (two concurrent debits can both read the same stale balance and both succeed).
 */
@Entity('credits_ledger')
@Index(['userId', 'createdAt'])
export class CreditLedger {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'user_id', type: 'uuid' }) userId: string;

  // Positive = credit (signup bonus, refund), negative = debit (analyze charge).
  @Column({ type: 'int' }) amount: number;

  @Column({ type: 'varchar' }) reason: CreditReason;

  // e.g. a pipeline_runs.id — lets you trace "why was this charged/refunded" back
  // to the thing that caused it. Nullable: signup_bonus has no reference.
  @Column({ name: 'reference_id', type: 'uuid', nullable: true })
  referenceId: string | null;

  // What kind of thing referenceId points at ('subscription', 'pipeline_run', ...).
  // Nullable and purely descriptive — referenceId alone is enough to look the row up
  // when the reason itself already implies the table (e.g. 'analyze' -> pipeline_runs).
  @Column({ name: 'reference_type', nullable: true }) referenceType:
    | string
    | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
