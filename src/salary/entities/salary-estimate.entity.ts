import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('salary_estimates')
export class SalaryEstimate {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'workspace_id', type: 'uuid', unique: true })
  workspaceId: string;
  @Column({ name: 'run_id', type: 'uuid' }) runId: string;

  @Column({ name: 'currency', type: 'char', length: 3 }) currency: string;
  @Column({ name: 'p25', type: 'int' }) p25: number;
  @Column({ name: 'p50', type: 'int' }) p50: number;
  @Column({ name: 'p75', type: 'int' }) p75: number;

  // Always true — the entity itself carries the flag so the UI can never accidentally
  // render this as a quote. There is no code path that sets it false.
  @Column({ name: 'is_estimate', default: true }) isEstimate: boolean;
  @Column({ type: 'text' }) methodology: string;
  @Column({ type: 'jsonb' }) factors: string[];
  @Column({ name: 'negotiation_tips', type: 'jsonb' })
  negotiationTips: string[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
