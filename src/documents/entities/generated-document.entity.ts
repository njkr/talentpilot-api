import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type DocType =
  | 'resume_pdf'
  | 'resume_docx'
  | 'cover_letter_pdf'
  | 'cover_letter_docx'
  | 'full_report_pdf';

@Entity('generated_documents')
@Index(['workspaceId', 'type'])
export class GeneratedDocument {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId: string;

  @Column({ type: 'varchar' }) type: DocType;

  @Column({ name: 'file_key', nullable: true }) fileKey: string | null;
  @Column({ name: 'file_size', type: 'int', nullable: true }) fileSize:
    | number
    | null;
  @Column() filename: string;

  // Which resume version this was built from. When the user accepts more
  // suggestions, every document built from the old version is stale.
  @Column({ name: 'resume_version', type: 'int', nullable: true })
  resumeVersion: number | null;
  @Column({ name: 'cover_letter_version', type: 'int', nullable: true })
  coverLetterVersion: number | null;

  @Column({ type: 'varchar', default: 'queued' })
  status: 'queued' | 'generating' | 'ready' | 'stale' | 'failed';

  @Column({ type: 'text', nullable: true }) error: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
