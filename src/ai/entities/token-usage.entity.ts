import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('token_usage')
@Index(['userId', 'createdAt']) // per-user daily budget query
@Index(['createdAt']) // global daily budget + cost dashboard
export class TokenUsage {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true }) userId:
    | string
    | null;
  @Column({ name: 'workspace_id', type: 'uuid', nullable: true })
  workspaceId: string | null;
  @Column({ name: 'run_id', type: 'uuid', nullable: true }) runId:
    | string
    | null;
  @Column({ name: 'step_name', nullable: true }) stepName: string | null;

  @Column() feature: string; // 'resume_extraction'
  @Column() model: string;
  @Column({ name: 'prompt_key', nullable: true }) promptKey: string | null;
  @Column({ name: 'prompt_version', type: 'int', nullable: true })
  promptVersion: number | null;

  @Column({ name: 'prompt_tokens', type: 'int' }) promptTokens: number;
  @Column({ name: 'completion_tokens', type: 'int' }) completionTokens: number;
  @Column({ name: 'cached_tokens', type: 'int', default: 0 })
  cachedTokens: number;

  // 6 decimal places: a single 4o-mini call can cost $0.0009. Rounding to 4 loses real
  // money once you're doing 100k calls. Returned by pg as a string (numeric), not a
  // number — never round-trip it through JS floating point.
  @Column({ name: 'cost_usd', type: 'numeric', precision: 12, scale: 6 })
  costUsd: string;

  @Column({ name: 'duration_ms', type: 'int' }) durationMs: number;
  @Column({ type: 'int', default: 1 }) attempts: number;
  @Column({ default: true }) success: boolean;
  @Column({ name: 'error_type', nullable: true }) errorType: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
