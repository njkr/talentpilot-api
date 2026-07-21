import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type RunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled';

@Entity('pipeline_runs')
@Index(['workspaceId', 'createdAt'])
export class PipelineRun {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId: string;

  @Column({ type: 'varchar', default: 'full_analyze' })
  trigger: 'full_analyze' | 'single_step' | 'retry';

  @Column({ type: 'varchar', default: 'queued' }) status: RunStatus;

  // Client-supplied UUID. UNIQUE -> a double-clicked "Analyze" returns the SAME run
  // instead of starting a second one and charging twice.
  @Column({ name: 'idempotency_key', unique: true }) idempotencyKey: string;

  @Column({ name: 'steps_total', type: 'int', default: 0 }) stepsTotal: number;
  @Column({ name: 'steps_completed', type: 'int', default: 0 })
  stepsCompleted: number;
  @Column({ type: 'int', default: 0 }) progress: number; // 0-100, weighted
  @Column({ name: 'current_step', nullable: true }) currentStep: string | null;

  @Column({ name: 'credits_charged', type: 'int', default: 0 })
  creditsCharged: number;
  @Column({ name: 'credits_refunded', type: 'int', default: 0 })
  creditsRefunded: number;

  @Column({
    name: 'total_cost_usd',
    type: 'numeric',
    precision: 12,
    scale: 6,
    default: 0,
  })
  totalCostUsd: string;

  @Column({ type: 'text', nullable: true }) error: string | null;
  @Column({ name: 'failed_steps', type: 'jsonb', default: () => "'[]'" })
  failedSteps: string[];

  @Column({ name: 'resume_version', type: 'int' }) resumeVersion: number;

  @Column({ name: 'queued_at', type: 'timestamptz', default: () => 'NOW()' })
  queuedAt: Date;
  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;
  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
