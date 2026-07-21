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
import type { JdAnalysis } from '../../ai/schemas/jd-analysis.schema';

export type JdStatus = 'pending' | 'analyzing' | 'analyzed' | 'failed';

@Entity('job_descriptions')
@Index(['userId'])
@Index(['userId', 'contentHash']) // dedupe lookup
export class JobDescription {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'user_id', type: 'uuid' }) userId: string;
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ nullable: true }) company: string | null;
  @Column() position: string;

  @Column({ name: 'description_raw', type: 'text' }) descriptionRaw: string;

  @Column({ type: 'varchar', default: 'paste' }) source:
    | 'paste'
    | 'upload'
    | 'url';

  @Column({ name: 'employment_type', nullable: true }) employmentType:
    | string
    | null;
  @Column({ nullable: true }) location: string | null;
  @Column({ name: 'remote_type', nullable: true }) remoteType: string | null;
  @Column({ name: 'experience_required', nullable: true })
  experienceRequired: string | null;

  @Column({ name: 'salary_min', type: 'int', nullable: true }) salaryMin:
    | number
    | null;
  @Column({ name: 'salary_max', type: 'int', nullable: true }) salaryMax:
    | number
    | null;
  @Column({ name: 'salary_currency', type: 'char', length: 3, nullable: true })
  salaryCurrency: string | null;

  // Output of the jd_analysis prompt. jsonb because the shape evolves with the prompt;
  // Zod validates it on write (via AiService's Structured Outputs), which is the real guarantee.
  @Column({ name: 'parsed_data', type: 'jsonb', nullable: true })
  parsedData: JdAnalysis | null;

  // sha256 of the normalized text. Same JD pasted twice → reuse, no second AI call.
  @Column({ name: 'content_hash' }) contentHash: string;

  @Column({ type: 'varchar', default: 'pending' }) status: JdStatus;
  @Column({ name: 'parse_error', type: 'text', nullable: true }) parseError:
    | string
    | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;
}
