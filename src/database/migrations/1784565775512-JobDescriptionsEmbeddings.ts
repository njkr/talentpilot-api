import { MigrationInterface, QueryRunner } from 'typeorm';

export class JobDescriptionsEmbeddings1784565775512 implements MigrationInterface {
  name = 'JobDescriptionsEmbeddings1784565775512';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector`);

    await queryRunner.query(
      `CREATE TABLE "job_descriptions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "company" character varying, "position" character varying NOT NULL, "description_raw" text NOT NULL, "source" character varying NOT NULL DEFAULT 'paste', "employment_type" character varying, "location" character varying, "remote_type" character varying, "experience_required" character varying, "salary_min" integer, "salary_max" integer, "salary_currency" character(3), "parsed_data" jsonb, "content_hash" character varying NOT NULL, "status" character varying NOT NULL DEFAULT 'pending', "parse_error" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_e5e847b0af4a4d33cee0ae1b04b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c6adfc59c4d06abb275546b83a" ON "job_descriptions"  ("user_id", "content_hash") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_931f3e297a104eb099f3626660" ON "job_descriptions"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "embeddings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "owner_type" character varying NOT NULL, "owner_id" uuid NOT NULL, "version" integer NOT NULL DEFAULT '1', "chunk_index" integer NOT NULL, "content" text NOT NULL, "embedding" character varying, "token_count" integer NOT NULL, "metadata" jsonb, "content_hash" character varying NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_00b95a4d21cb2aef06c19ce6077" UNIQUE ("owner_type", "owner_id", "version", "chunk_index"), CONSTRAINT "PK_19b6b451e1ef345884caca1f544" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_02f4fc33a347701aebd8546254" ON "embeddings"  ("owner_type", "owner_id", "version") `,
    );
    await queryRunner.query(
      `ALTER TABLE "job_descriptions" ADD CONSTRAINT "FK_931f3e297a104eb099f36266600" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    /**
     * The entity declares `embedding` as varchar only so migration:generate has a
     * concrete column to diff (TypeORM has no native pgvector type). Replace it with
     * the real type here.
     *
     * ⚠️ NO HNSW index, deliberately. Every similarity query (EmbeddingsService.
     * matchRequirements) filters to one owner first — WHERE owner_type=... AND
     * owner_id=... AND version=... — leaving ~40-60 rows, which the b-tree index
     * above already narrows down before any vector math runs. An ANN index like
     * HNSW operates over the WHOLE table and can't be used after that filter, so it
     * would cost slower inserts and real memory for zero query benefit. Add one only
     * if a global cross-user search is introduced later:
     *   CREATE INDEX CONCURRENTLY embeddings_hnsw ON embeddings
     *     USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64);
     */
    await queryRunner.query(`ALTER TABLE "embeddings" DROP COLUMN "embedding"`);
    await queryRunner.query(
      `ALTER TABLE "embeddings" ADD COLUMN "embedding" vector(1536)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "job_descriptions" DROP CONSTRAINT "FK_931f3e297a104eb099f36266600"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_02f4fc33a347701aebd8546254"`,
    );
    await queryRunner.query(`DROP TABLE "embeddings"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_931f3e297a104eb099f3626660"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c6adfc59c4d06abb275546b83a"`,
    );
    await queryRunner.query(`DROP TABLE "job_descriptions"`);
    await queryRunner.query(`DROP EXTENSION IF EXISTS vector`);
  }
}
