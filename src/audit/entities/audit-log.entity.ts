import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// Append-only. No FK to users (a failed-login row may have no userId, and a
// deleted user's history must survive the delete) — userId is a loose reference.
@Entity('audit_logs')
@Index(['userId'])
@Index(['action'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ name: 'actor_type', type: 'varchar', default: 'user' })
  actorType: 'user' | 'system' | 'admin';

  @Column({ type: 'varchar' }) action: string;

  @Column({ name: 'resource_type', type: 'varchar' }) resourceType: string;

  @Column({ type: 'inet', nullable: true }) ip: string | null;
  @Column({ name: 'user_agent', nullable: true }) userAgent: string | null;

  @Column({ type: 'jsonb', default: {} }) metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
