import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type CreditReason = 'signup_bonus' | 'analyze' | 'refund' | 'grant';

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

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
