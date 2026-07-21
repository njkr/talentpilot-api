import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * The per-workspace copy of a CompanyResearchCache payload (or a fresh synthesis when
 * nothing was cached). Denormalised on purpose: a workspace must keep showing the same
 * insight it was generated with even if the global cache entry later expires or gets
 * refreshed by someone else's run.
 */
@Entity('company_insights')
export class CompanyInsight {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'workspace_id', type: 'uuid', unique: true })
  workspaceId: string;
  @Column({ name: 'run_id', type: 'uuid' }) runId: string;

  @Column({ name: 'company_name' }) companyName: string;
  @Column({ type: 'text' }) overview: string;
  @Column({ type: 'jsonb' }) culture: string[];
  @Column({ name: 'talking_points', type: 'jsonb' }) talkingPoints: string[];
  @Column({ type: 'jsonb' }) sources: string[];
  @Column({ type: 'varchar' }) confidence: 'high' | 'medium' | 'low';
  @Column({ name: 'from_cache', default: false }) fromCache: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
