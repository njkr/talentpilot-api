import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PlanKey } from './plan.entity';

export type SubscriptionStatus =
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'incomplete';

/**
 * One row per user who has EVER started a paid checkout — a free-plan user with no
 * row at all is the common case (PlanLimitService.planFor() treats "no row" as
 * 'free'), avoiding a row-per-signup that would never be touched again for ~90% of
 * users. `lastEventAt` guards against Stripe's at-least-once, any-order webhook
 * delivery: an event older than what's already applied is a no-op, not a regression.
 */
@Entity('subscriptions')
@Index(['stripeCustomerId'])
export class Subscription {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'user_id', type: 'uuid', unique: true }) userId: string;

  @Column({ name: 'stripe_customer_id', nullable: true }) stripeCustomerId:
    | string
    | null;
  @Column({ name: 'stripe_subscription_id', nullable: true, unique: true })
  stripeSubscriptionId: string | null;

  @Column({ name: 'plan_key', type: 'varchar', default: 'free' })
  planKey: PlanKey;
  @Column({ type: 'varchar', default: 'active' }) status: SubscriptionStatus;

  @Column({ name: 'current_period_end', type: 'timestamptz', nullable: true })
  currentPeriodEnd: Date | null;
  @Column({ name: 'cancel_at_period_end', default: false })
  cancelAtPeriodEnd: boolean;

  // The Stripe event `created` timestamp of the last webhook event actually applied
  // to this row — NOT this row's own updatedAt.
  @Column({ name: 'last_event_at', type: 'timestamptz', nullable: true })
  lastEventAt: Date | null;

  // When this subscription's monthly credits were last granted. Lets
  // PaymentsService.reconcileAll() detect a MISSED invoice.payment_succeeded webhook
  // (status can be perfectly correct while the credit grant silently never
  // happened) — a different failure mode than lastEventAt, which only tracks
  // whether status/period fields are up to date.
  @Column({ name: 'last_refill_at', type: 'timestamptz', nullable: true })
  lastRefillAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
