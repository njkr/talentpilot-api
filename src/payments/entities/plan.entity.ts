import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type PlanKey = 'free' | 'pro' | 'ultimate';

/**
 * Replaces the Sprint 2 `PLAN_LIMITS` stub (src/subscriptions/plan-limit.service.ts)
 * that anticipated exactly this table. `stripePriceId` is nullable because the free
 * plan has no Stripe price at all, and pro/ultimate may be null until an operator
 * fills them in for a given environment (test-mode vs. live-mode price ids differ).
 */
@Entity('plans')
export class Plan {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ type: 'varchar', unique: true }) key: PlanKey;
  @Column() name: string;

  @Column({ name: 'monthly_credits', type: 'int' }) monthlyCredits: number;
  // -1 = unlimited, matching the Sprint 2 stub's convention.
  @Column({ name: 'max_resumes', type: 'int' }) maxResumes: number;
  @Column({ name: 'max_workspaces', type: 'int' }) maxWorkspaces: number;

  @Column({ name: 'price_usd', type: 'numeric', precision: 8, scale: 2 })
  priceUsd: string;
  @Column({ name: 'stripe_price_id', nullable: true }) stripePriceId:
    | string
    | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
