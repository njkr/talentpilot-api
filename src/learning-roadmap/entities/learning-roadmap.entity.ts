import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export interface LearningRoadmapItem {
  title: string;
  gapReason: string;
  resourceType: 'documentation' | 'course' | 'book' | 'project' | 'other';
  url: string | null;
  estHours: number;
  priority: 'required' | 'preferred';
}

// One row per workspace — capped at 6 items (see BuildLearningPathStep), so this is
// never large enough to warrant a child table the way ai_suggestions needed one.
@Entity('learning_roadmaps')
export class LearningRoadmap {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'workspace_id', type: 'uuid', unique: true })
  workspaceId: string;
  @Column({ name: 'run_id', type: 'uuid' }) runId: string;

  @Column({ type: 'jsonb' }) items: LearningRoadmapItem[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
