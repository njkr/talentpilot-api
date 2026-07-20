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

export type ResumeStatus =
  | 'uploaded' // file in S3, nothing read yet
  | 'extracting' // worker is pulling text out
  | 'extracted' // raw_text ready; AI parse queued
  | 'parsing' // AI structuring (later sprint)
  | 'parsed' // ready to use in a workspace
  | 'failed'; // see parseError

@Entity('resumes')
@Index(['userId'])
@Index(['userId', 'contentHash']) // dedupe lookup
export class Resume {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'user_id', type: 'uuid' }) userId: string;
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column() title: string; // defaults to the original filename

  @Column({ name: 'original_file_key' }) originalFileKey: string;
  @Column({ name: 'original_filename' }) originalFilename: string;
  @Column({ name: 'mime_type' }) mimeType: string;
  @Column({ name: 'file_size', type: 'int' }) fileSize: number;

  @Column({ name: 'page_count', type: 'int', nullable: true })
  pageCount: number | null;

  // The extracted plain text. Extracted ONCE and reused by every downstream step
  // (AI parse, embeddings, ATS) — never re-parse the PDF.
  @Column({ name: 'raw_text', type: 'text', nullable: true })
  rawText: string | null;

  @Column({ name: 'word_count', type: 'int', nullable: true })
  wordCount: number | null;

  @Column({ type: 'char', length: 2, nullable: true })
  language: string | null;

  // sha256 of the file bytes. Re-uploading the identical file returns the existing
  // resume instead of paying for a second AI parse.
  @Column({ name: 'content_hash', nullable: true }) contentHash: string | null;

  @Column({ name: 'current_version', type: 'int', default: 1 })
  currentVersion: number;

  @Column({ type: 'varchar', default: 'uploaded' }) status: ResumeStatus;

  // User-facing reason. Must be readable by a human — this string is rendered in the UI.
  @Column({ name: 'parse_error', type: 'text', nullable: true })
  parseError: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;
}
