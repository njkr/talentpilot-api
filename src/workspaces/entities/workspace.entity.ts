import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { Resume } from '../../resumes/entities/resume.entity';
import { JobDescription } from '../../job-descriptions/entities/job-description.entity';

export type WorkspaceStatus =
  | 'created'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'partial'
  | 'failed';

@Entity('workspaces')
@Index(['userId'])
@Index(['resumeId'])
@Index(['jobDescriptionId'])
export class Workspace {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'user_id', type: 'uuid' }) userId: string;
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'resume_id', type: 'uuid' }) resumeId: string;
  @Column({ name: 'job_description_id', type: 'uuid' })
  jobDescriptionId: string;

  // RESTRICT: deleting a resume/JD in use by a workspace must fail (Sprint 2 §9).
  @ManyToOne(() => Resume, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'resume_id' })
  resume: Resume;
  @ManyToOne(() => JobDescription, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'job_description_id' })
  jobDescription: JobDescription;

  @Column() name: string;

  // Denormalized from the latest run. Saves a join on every list query, and the
  // frontend renders the workspace card straight off it.
  @Column({ type: 'varchar', default: 'created' }) status: WorkspaceStatus;
  @Column({ name: 'last_run_id', type: 'uuid', nullable: true }) lastRunId:
    | string
    | null;

  // Snapshot of the resume version analyzed. Without this, a user edits their resume
  // and the ATS report silently refers to text that no longer exists.
  @Column({ name: 'analyzed_resume_version', type: 'int', nullable: true })
  analyzedResumeVersion: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;
}
