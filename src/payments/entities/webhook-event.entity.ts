import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Idempotency record for Stripe webhooks. The row is inserted FIRST, before any
 * side effect — a unique constraint violation on `eventId` (Postgres 23505) means
 * this exact event was already processed, so PaymentsService returns silently
 * instead of double-crediting a refill or double-activating a subscription. Stripe
 * retries webhooks that don't 200 in time, and delivers at-least-once even without
 * a timeout, so this isn't a theoretical edge case.
 */
@Entity('webhook_events')
export class WebhookEvent {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'event_id', unique: true }) eventId: string;
  @Column() type: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
