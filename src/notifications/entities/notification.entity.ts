import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('notifications')
@Index(['userId', 'createdAt'])
export class Notification {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId: string;

  @Column({ type: 'varchar' }) type: string; // e.g. 'analysis_complete', 'analysis_failed'
  @Column() title: string;
  @Column({ type: 'text' }) message: string;

  // Arbitrary extra context for the frontend to route/act on (workspaceId, deepLink, ...).
  @Column({ type: 'jsonb', default: () => "'{}'" }) data: Record<
    string,
    unknown
  >;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
