import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// Widened from a 'free'|'pro'|'ultimate' literal union (Sprint 10) to a plain string:
// Sprint 13 lets an admin create arbitrary custom plans through the admin panel, so the
// set of valid keys is no longer knowable at compile time. The DB column was always a
// plain varchar (never a pg enum), so this is a type-level-only change — every existing
// comparison ('free' === plan.key, etc.) keeps working exactly as before.
export type PlanKey = string;

export interface PlanLimits {
  maxResumes: number; // -1 = unlimited
  maxWorkspaces: number; // -1 = unlimited
  regenPerDay: number; // -1 = unlimited (not yet enforced anywhere — reserved for a future rate limit)
}

/**
 * Sprint 13: admin-editable plans that sync to Stripe. Prices moved from a single
 * nullable `stripePriceId` (Sprint 10) to `stripePriceIds` because a plan now has both
 * a monthly and a yearly price. `stripeProductId`/`stripePriceIds` are populated and
 * maintained EXCLUSIVELY by StripeSyncService — never hand-edited, since a Stripe Price
 * is immutable and the sync service is the only thing that knows how to replace one
 * safely (create new, archive old, without touching existing subscribers).
 */
@Entity('plans')
export class Plan {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ type: 'varchar', unique: true }) key: PlanKey;
  @Column() name: string;
  @Column({ type: 'text', nullable: true }) description: string | null;

  @Column({ name: 'price_monthly_cents', type: 'int', default: 0 })
  priceMonthlyCents: number;
  @Column({ name: 'price_yearly_cents', type: 'int', default: 0 })
  priceYearlyCents: number;

  @Column({ name: 'monthly_credits', type: 'int' }) monthlyCredits: number;

  // -1 = unlimited, matching the Sprint 2 stub's convention.
  @Column({ type: 'jsonb' }) limits: PlanLimits;

  // ── Stripe refs (managed by StripeSyncService, NOT hand-edited) ──
  @Column({ name: 'stripe_product_id', nullable: true }) stripeProductId:
    | string
    | null;
  @Column({ name: 'stripe_price_ids', type: 'jsonb', default: () => "'{}'" })
  stripePriceIds: { monthly?: string; yearly?: string };

  // inactive = hidden from /plans and new checkouts; existing subscribers keep working
  // (their subscription references a Stripe price directly, not this row's active flag).
  @Column({ default: true }) active: boolean;
  @Column({ name: 'display_order', type: 'int', default: 0 })
  displayOrder: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
