import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('refresh_tokens')
@Index(['userId'])
@Index(['familyId'])
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid') id: string; // this id is the public half of the token

  @Column({ name: 'user_id', type: 'uuid' }) userId: string;
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  // All tokens descended from one login share a familyId. Theft on any one of them
  // kills the whole family — i.e. that device's session — not the user's other devices.
  @Column({ name: 'family_id', type: 'uuid' }) familyId: string;

  @Column({ name: 'token_hash' }) tokenHash: string; // sha256 of the secret half

  @Column({ name: 'user_agent', nullable: true }) userAgent: string | null;
  @Column({ type: 'inet', nullable: true }) ip: string | null;

  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({ name: 'revoked_reason', type: 'varchar', nullable: true })
  revokedReason:
    | 'rotated'
    | 'logout'
    | 'reuse_detected'
    | 'password_reset'
    | 'account_deleted'
    | null;

  // Set when this token is rotated. Presence of this + a recent revokedAt = a race, not theft.
  @Column({ name: 'replaced_by_id', type: 'uuid', nullable: true })
  replacedById: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
