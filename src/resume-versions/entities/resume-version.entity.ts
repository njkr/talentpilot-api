import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity('resume_versions')
@Unique(['resumeId', 'version'])
export class ResumeVersion {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'resume_id', type: 'uuid' }) resumeId: string;
  @Column({ type: 'int' }) version: number;

  @Column() label: string; // "Optimised for Stripe — Backend Engineer"
  @Column({ name: 'change_summary', type: 'text' }) changeSummary: string;
  @Column({ name: 'created_by', type: 'varchar' })
  createdBy: 'user' | 'ai' | 'restore';
  @Column({ name: 'workspace_id', type: 'uuid', nullable: true })
  workspaceId: string | null;
  @Column({ name: 'suggestions_applied', type: 'int', default: 0 })
  suggestionsApplied: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
