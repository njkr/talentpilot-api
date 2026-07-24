import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * One row per user, keyed directly by userId (no surrogate id needed — it's a 1:1
 * settings row, not a growing log). Opt-OUT model: a notification type not present
 * in `emailDisabled` is emailed by default, matching how NotificationPreference.get()
 * treats a missing row entirely (see notifications.service.ts) — a brand-new user
 * who never touched their settings still gets emailed.
 */
@Entity('notification_preferences')
export class NotificationPreference {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' }) userId: string;

  @Column({ name: 'email_disabled', type: 'jsonb', default: () => "'[]'" })
  emailDisabled: string[];
}
