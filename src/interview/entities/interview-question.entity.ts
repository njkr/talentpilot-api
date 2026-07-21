import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('interview_questions')
@Index(['workspaceId'])
export class InterviewQuestion {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId: string;
  @Column({ name: 'run_id', type: 'uuid' }) runId: string;

  @Column({ type: 'varchar' })
  type: 'hr' | 'behavioral' | 'technical' | 'coding' | 'system_design';
  @Column({ type: 'varchar' }) difficulty: 'easy' | 'medium' | 'hard';

  @Column({ type: 'text' }) question: string;
  @Column({ name: 'ideal_answer', type: 'text' }) idealAnswer: string;
  @Column({ type: 'varchar', nullable: true }) framework: string | null;
  @Column({ name: 'why_asked', type: 'text' }) whyAsked: string;
  @Column({ name: 'based_on', type: 'text', nullable: true }) basedOn:
    | string
    | null;

  // ── Practice mode ── the candidate answers, gets AI feedback, pays 1 credit per try.
  @Column({ name: 'user_answer', type: 'text', nullable: true }) userAnswer:
    | string
    | null;
  @Column({ name: 'ai_feedback', type: 'text', nullable: true }) aiFeedback:
    | string
    | null;
  @Column({ name: 'answer_score', type: 'int', nullable: true }) answerScore:
    | number
    | null;
  @Column({ name: 'answered_at', type: 'timestamptz', nullable: true })
  answeredAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
