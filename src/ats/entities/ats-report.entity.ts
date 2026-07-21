import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export interface ScoreBreakdownEntry {
  component: string;
  score: number;
  weight: number;
  contribution: number;
}

@Entity('ats_reports')
@Index(['workspaceId', 'createdAt'])
export class AtsReport {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId: string;
  @Column({ name: 'run_id', type: 'uuid' }) runId: string;

  @Column({ name: 'overall_score', type: 'int' }) overallScore: number;

  @Column({ name: 'keyword_score', type: 'int' }) keywordScore: number;
  @Column({ name: 'semantic_score', type: 'int' }) semanticScore: number;
  @Column({ name: 'experience_score', type: 'int' }) experienceScore: number;
  @Column({ name: 'education_score', type: 'int', nullable: true })
  educationScore: number | null; // null = not applicable (JD has no education requirement)
  @Column({ name: 'project_score', type: 'int' }) projectScore: number;
  @Column({ name: 'format_score', type: 'int' }) formatScore: number;
  @Column({ name: 'grammar_score', type: 'int' }) grammarScore: number;

  // Persisted so the UI can SHOW the formula. A score the user can't interrogate is a
  // score they won't trust.
  @Column({ name: 'score_breakdown', type: 'jsonb' })
  scoreBreakdown: ScoreBreakdownEntry[];

  @Column({ type: 'text' }) summary: string;
  @Column({ type: 'jsonb' }) strengths: string[];
  @Column({ type: 'jsonb' }) weaknesses: string[];
  @Column({ type: 'jsonb' }) recommendations: string[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
