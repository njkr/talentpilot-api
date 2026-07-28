import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A one-time credit top-up, independent of any subscription. Synced to Stripe the
 * same immutable-price way plans are (StripeSyncService.syncCreditPack) — the only
 * difference is the Stripe Price has no `recurring` block, since this is a `mode:
 * 'payment'` Checkout session, not a subscription.
 */
@Entity('credit_packs')
export class CreditPack {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column() name: string; // "Small pack"
  @Column({ type: 'text', nullable: true }) description: string | null;
  @Column({ type: 'int' }) credits: number; // 100
  @Column({ name: 'price_cents', type: 'int' }) priceCents: number; // 500

  @Column({ name: 'stripe_product_id', nullable: true }) stripeProductId:
    | string
    | null;
  @Column({ name: 'stripe_price_id', nullable: true }) stripePriceId:
    | string
    | null;

  @Column({ default: true }) active: boolean;
  @Column({ name: 'display_order', type: 'int', default: 0 })
  displayOrder: number;
  @Column({ name: 'best_value', default: false }) bestValue: boolean; // UI highlight flag

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
