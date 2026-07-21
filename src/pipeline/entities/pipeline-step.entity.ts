import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { PipelineRun } from './pipeline-run.entity';

export type StepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped';

@Entity('pipeline_steps')
@Unique(['runId', 'name']) // <- this is what makes retries idempotent (StepRunner)
@Index(['runId'])
export class PipelineStep {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'run_id', type: 'uuid' }) runId: string;
  @ManyToOne(() => PipelineRun, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id' })
  run: PipelineRun;

  @Column() name: string;
  @Column({ type: 'varchar', default: 'pending' }) status: StepStatus;

  @Column({ type: 'int', default: 0 }) attempt: number;

  // Where the artifact landed, e.g. 'ats_reports:uuid'. Lets an admin inspector jump
  // straight from a step to what it produced.
  @Column({ name: 'output_ref', nullable: true }) outputRef: string | null;

  @Column({
    name: 'cost_usd',
    type: 'numeric',
    precision: 12,
    scale: 6,
    default: 0,
  })
  costUsd: string;

  @Column({ type: 'text', nullable: true }) error: string | null;
  @Column({ name: 'error_type', nullable: true }) errorType: string | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;
  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;
}
