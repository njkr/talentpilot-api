import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { Resume } from '../../resumes/entities/resume.entity';

// Minimal placeholder: Sprint 2 only needs enough of "workspace" to know a resume is
// in use and block deleting it (S2-05). The full workspace feature (AI artifacts,
// analysis runs, credits) lands in a later sprint — don't build on this beyond that
// single guard without revisiting the shape.
@Entity('workspaces')
@Index(['userId'])
@Index(['resumeId'])
export class Workspace {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'user_id', type: 'uuid' }) userId: string;
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'resume_id', type: 'uuid' }) resumeId: string;
  @ManyToOne(() => Resume, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'resume_id' })
  resume: Resume;

  @Column() name: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
