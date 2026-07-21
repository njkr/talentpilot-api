import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// Only these four section types carry freeform prose worth rewriting — personal_info,
// education, certifications, and languages are structured facts, not something an
// optimiser should be rephrasing.
export type OptimizableSectionType =
  | 'summary'
  | 'experience'
  | 'projects'
  | 'skills';

@Entity('ai_suggestions')
@Index(['workspaceId', 'status'])
export class AiSuggestion {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId: string;
  @Column({ name: 'run_id', type: 'uuid' }) runId: string;

  @Column({ name: 'section_type', type: 'varchar' })
  sectionType: OptimizableSectionType;

  /**
   * WHICH item inside the section. Sections are jsonb arrays (or a single object for
   * `summary`), so we need to point at one entry: itemIndex is position within the
   * array, bulletIndex is the highlight within an experience item (null = the whole
   * item's own text, e.g. a project's description or a skill string).
   */
  @Column({ name: 'item_index', type: 'int', nullable: true })
  itemIndex: number | null;
  @Column({ name: 'bullet_index', type: 'int', nullable: true })
  bulletIndex: number | null;

  @Column({ name: 'old_text', type: 'text' }) oldText: string;
  @Column({ name: 'new_text', type: 'text' }) newText: string;

  /**
   * sha256 of oldText at generation time. If the user edits that bullet before
   * accepting, the hash no longer matches what's in the DB and we refuse to apply —
   * otherwise we'd silently overwrite their edit with text based on a stale version.
   */
  @Column({ name: 'old_text_hash' }) oldTextHash: string;

  @Column({ type: 'text' }) reason: string;
  @Column({ type: 'varchar' }) impact: 'high' | 'medium' | 'low';
  @Column({ name: 'keywords_added', type: 'jsonb', default: () => "'[]'" })
  keywordsAdded: string[];

  @Column({ type: 'varchar', default: 'pending' })
  status: 'pending' | 'accepted' | 'rejected' | 'stale';

  @Column({ name: 'applied_version', type: 'int', nullable: true })
  appliedVersion: number | null;
  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
