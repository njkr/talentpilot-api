import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { createHash } from 'crypto';
import { Embedding, EmbeddingOwnerType } from './entities/embedding.entity';
import { Chunk } from './services/chunker.service';
import { AiService } from '../ai/ai.service';

export interface RequirementMatch {
  requirement_index: number;
  requirement: string;
  importance: string | null;
  best_chunk: string | null;
  section_type: string | null;
  section_label: string | null;
  similarity: string; // numeric comes back from pg as a string
}

const EMBED_BATCH_SIZE = 50;

@Injectable()
export class EmbeddingsService {
  constructor(
    @InjectRepository(Embedding) private readonly repo: Repository<Embedding>,
    private readonly ai: AiService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Embeds chunks for an owner, skipping any whose content hasn't changed. Re-running
   * analysis on an unedited resume/JD must cost ZERO embedding calls — this is the
   * whole point of content-hashing each chunk before deciding what to (re)embed.
   */
  async embedOwner(
    ownerType: EmbeddingOwnerType,
    ownerId: string,
    version: number,
    chunks: Chunk[],
    userId: string,
  ): Promise<{ embedded: number; reused: number }> {
    const existing = await this.repo.find({
      where: { ownerType, ownerId, version },
      select: { chunkIndex: true, contentHash: true },
    });
    const hashByIndex = new Map(
      existing.map((e) => [e.chunkIndex, e.contentHash]),
    );

    const todo: Array<Chunk & { contentHash: string }> = [];
    for (const c of chunks) {
      const contentHash = createHash('sha256').update(c.content).digest('hex');
      if (hashByIndex.get(c.index) === contentHash) continue; // unchanged → reuse
      todo.push({ ...c, contentHash });
    }

    if (todo.length === 0) return { embedded: 0, reused: chunks.length };

    // Batch: the embeddings API accepts many inputs per call, and one call of 50 is
    // dramatically cheaper in latency than 50 calls of one.
    for (let i = 0; i < todo.length; i += EMBED_BATCH_SIZE) {
      const batch = todo.slice(i, i + EMBED_BATCH_SIZE);
      const { vectors } = await this.ai.embed(
        batch.map((c) => c.content),
        { feature: `embed_${ownerType}`, userId },
      );

      // One transaction per batch: a partially-embedded owner would silently produce
      // wrong similarity scores, which is worse than a visible failure.
      await this.dataSource.transaction(async (m) => {
        for (let j = 0; j < batch.length; j++) {
          const c = batch[j];
          /**
           * Raw SQL because TypeORM has no binding for pgvector's type. The `$6::vector`
           * cast turns the '[0.1,0.2,...]' string literal into pgvector's native type.
           * ON CONFLICT makes re-embedding idempotent (a retried job overwrites cleanly).
           */
          await m.query(
            `INSERT INTO embeddings
               (id, owner_type, owner_id, version, chunk_index, content,
                embedding, token_count, metadata, content_hash, created_at)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6::vector, $7, $8, $9, NOW())
             ON CONFLICT (owner_type, owner_id, version, chunk_index)
             DO UPDATE SET content      = EXCLUDED.content,
                           embedding    = EXCLUDED.embedding,
                           token_count  = EXCLUDED.token_count,
                           metadata     = EXCLUDED.metadata,
                           content_hash = EXCLUDED.content_hash`,
            [
              ownerType,
              ownerId,
              version,
              c.index,
              c.content,
              `[${vectors[j].join(',')}]`,
              c.tokenCount,
              JSON.stringify(c.metadata ?? {}),
              c.contentHash,
            ],
          );
        }
      });
    }

    return { embedded: todo.length, reused: chunks.length - todo.length };
  }

  /**
   * For each JD requirement, finds the best-matching resume chunk. ONE query does all
   * of it via a lateral join — not N queries in a loop. With 20 requirements the loop
   * version is 20 round-trips; this is one.
   *
   * `<=>` is pgvector's cosine DISTANCE operator (0 = identical, 2 = opposite).
   * text-embedding-3 vectors are unit-normalized, so cosine distance and dot product
   * agree — no manual normalization needed. Similarity = 1 - distance.
   */
  async matchRequirements(
    resumeId: string,
    resumeVersion: number,
    jdId: string,
  ): Promise<RequirementMatch[]> {
    return this.dataSource.query(
      `
      SELECT jd.chunk_index                 AS requirement_index,
             jd.content                     AS requirement,
             jd.metadata->>'label'          AS importance,
             best.content                   AS best_chunk,
             best.metadata->>'sectionType'  AS section_type,
             best.metadata->>'label'        AS section_label,
             1 - best.distance              AS similarity
      FROM embeddings jd
      CROSS JOIN LATERAL (
        SELECT r.content, r.metadata, r.embedding <=> jd.embedding AS distance
        FROM embeddings r
        WHERE r.owner_type = 'resume' AND r.owner_id = $1 AND r.version = $2
        ORDER BY r.embedding <=> jd.embedding
        LIMIT 1
      ) best
      WHERE jd.owner_type = 'job_description' AND jd.owner_id = $3 AND jd.version = 1
      ORDER BY jd.chunk_index
      `,
      [resumeId, resumeVersion, jdId],
    );
  }

  async deleteFor(
    ownerType: EmbeddingOwnerType,
    ownerId: string,
  ): Promise<void> {
    await this.repo.delete({ ownerType, ownerId });
  }
}
