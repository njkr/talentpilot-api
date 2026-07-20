import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Resume } from './resume.entity';

export type SectionType =
  | 'personal_info'
  | 'summary'
  | 'skills'
  | 'experience'
  | 'projects'
  | 'education'
  | 'certifications'
  | 'languages';

@Entity('resume_sections')
@Index(['resumeId', 'version'])
export class ResumeSection {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'resume_id', type: 'uuid' }) resumeId: string;
  @ManyToOne(() => Resume, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'resume_id' })
  resume: Resume;

  @Column({ type: 'int', default: 1 }) version: number;
  @Column({ name: 'section_type', type: 'varchar' }) sectionType: SectionType;

  // Shape varies by sectionType (see prompts/schemas). jsonb, not separate tables: the
  // structure is model-defined and will evolve; 8 rigid tables would fight every prompt
  // improvement. We validate on write with Zod, which is the real guarantee.
  @Column({ type: 'jsonb' }) content: unknown;

  @Column({ name: 'order_index', type: 'int', default: 0 }) orderIndex: number;

  // Parser's self-reported certainty. < 0.6 → the UI flags "please check this section".
  // Returned by pg as a string (numeric), same reasoning as TokenUsage.costUsd.
  @Column({ type: 'numeric', precision: 3, scale: 2, nullable: true })
  confidence: string | null;

  @Column({ name: 'ai_generated', default: true }) aiGenerated: boolean;
  @Column({ name: 'edited_by_user', default: false }) editedByUser: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
