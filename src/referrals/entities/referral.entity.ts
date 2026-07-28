import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type ReferralStatus =
  | 'pending'
  | 'signed_up'
  | 'qualified'
  | 'rewarded'
  | 'expired';

/**
 * One row per invite, created the moment the invited person signs up (not when the
 * code is generated or shared — an unused code has nothing to track). Rewards are
 * deferred until the qualifying event configured in PaymentConfig — see
 * ReferralsService.checkQualification() for why signup alone must never pay out.
 */
@Entity('referrals')
@Index(['referrerId'])
export class Referral {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'referrer_id', type: 'uuid' }) referrerId: string; // the inviter
  @Column({ name: 'referee_id', type: 'uuid', unique: true })
  refereeId: string; // the invited user — unique: one referral per referee, ever

  @Column({ name: 'referee_email', nullable: true }) refereeEmail:
    | string
    | null;

  @Column({ type: 'varchar', default: 'pending' })
  status: ReferralStatus;

  @Column({ name: 'reward_granted', default: false }) rewardGranted: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @Column({ name: 'qualified_at', type: 'timestamptz', nullable: true })
  qualifiedAt: Date | null;
}
