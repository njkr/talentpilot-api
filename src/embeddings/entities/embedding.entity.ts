import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

export type EmbeddingOwnerType = 'resume' | 'job_description';

@Entity('embeddings')
// THE index that matters: every query filters to one owner first (see matchRequirements).
@Index(['ownerType', 'ownerId', 'version'])
@Unique(['ownerType', 'ownerId', 'version', 'chunkIndex'])
export class Embedding {
  @PrimaryGeneratedColumn('uuid') id: string;

  // Polymorphic owner. A join table per owner type would be cleaner in theory and
  // annoying in practice — two types, one query shape, no FK integrity lost that matters
  // (deletes are handled by the owning service, not a DB constraint).
  @Column({ name: 'owner_type', type: 'varchar' })
  ownerType: EmbeddingOwnerType;
  @Column({ name: 'owner_id', type: 'uuid' }) ownerId: string;

  @Column({ type: 'int', default: 1 }) version: number; // resume version; JD always 1
  @Column({ name: 'chunk_index', type: 'int' }) chunkIndex: number;

  @Column({ type: 'text' }) content: string; // the chunk text itself

  /**
   * The vector column. TypeORM has no native type for pgvector, so it is:
   *   - created here as a plain column so migration:generate has something to diff, then
   *     hand-patched in the migration to the real `vector(1536)` type (see the migration file)
   *   - declared select:false/insert:false/update:false so the migration generator stops
   *     trying to "fix" it back to varchar on every subsequent run
   *   - read and written exclusively via raw SQL (EmbeddingsService)
   */
  @Column({
    type: 'varchar',
    select: false,
    insert: false,
    update: false,
    nullable: true,
  })
  embedding: string;

  @Column({ name: 'token_count', type: 'int' }) tokenCount: number;

  // What this chunk came from — lets us say "matched in your experience section".
  @Column({ type: 'jsonb', nullable: true })
  metadata: { sectionType?: string; label?: string } | null;

  // sha256 of `content`. If unchanged on re-analysis, skip the embedding call entirely.
  @Column({ name: 'content_hash' }) contentHash: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
