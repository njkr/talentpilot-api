import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('cover_letters')
@Index(['workspaceId', 'version'])
export class CoverLetter {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId: string;
  @Column({ name: 'run_id', type: 'uuid', nullable: true }) runId:
    | string
    | null;
  @Column({ type: 'int', default: 1 }) version: number;

  @Column({ type: 'varchar', default: 'professional' })
  tone: 'professional' | 'friendly' | 'confident' | 'enthusiastic';
  @Column({ type: 'varchar', default: 'standard' }) length:
    | 'short'
    | 'standard'
    | 'long';

  @Column({ type: 'text' }) content: string;
  @Column({ name: 'word_count', type: 'int' }) wordCount: number;
  @Column({ name: 'is_current', default: true }) isCurrent: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
