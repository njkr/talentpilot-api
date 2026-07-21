import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Hand-written, not machine-generated: Docker/Postgres was unavailable in the
 * environment this was authored in, and `migration:generate` needs a live DB to diff
 * against. The DDL below was derived directly from the Sprint 7/8 entities (verified by
 * hand, column-by-column, against their @Column decorators) rather than copied from a
 * generator's output — but unlike every other migration in this repo, it has NOT yet
 * been run-verified against a real Postgres instance. Before relying on it: run
 * `npm run m:run`, then diff `npm run m:gen -- --name=Verify` against it (should
 * produce an empty migration) to confirm there's no drift, exactly as every prior
 * sprint's migration was hand-patched and then verified via `\d <table>`.
 *
 * No foreign-key constraints here, matching the existing precedent (ats_reports,
 * pipeline_runs, etc. also store workspace_id/run_id as plain uuid columns, not
 * @ManyToOne relations) — every new table follows the same "plain uuid, app-level
 * ownership check" style already established in Sprint 5/6.
 */
export class OptimizationCoverLetterGenerators1784638503256 implements MigrationInterface {
  name = 'OptimizationCoverLetterGenerators1784638503256';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── ai_suggestions ──
    await queryRunner.query(
      `CREATE TABLE "ai_suggestions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspace_id" uuid NOT NULL, "run_id" uuid NOT NULL, "section_type" character varying NOT NULL, "item_index" integer, "bullet_index" integer, "old_text" text NOT NULL, "new_text" text NOT NULL, "old_text_hash" character varying NOT NULL, "reason" text NOT NULL, "impact" character varying NOT NULL, "keywords_added" jsonb NOT NULL DEFAULT '[]', "status" character varying NOT NULL DEFAULT 'pending', "applied_version" integer, "decided_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ai_suggestions" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ai_suggestions_workspace_status" ON "ai_suggestions" ("workspace_id", "status")`,
    );

    // ── resume_versions ──
    await queryRunner.query(
      `CREATE TABLE "resume_versions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "resume_id" uuid NOT NULL, "version" integer NOT NULL, "label" character varying NOT NULL, "change_summary" text NOT NULL, "created_by" character varying NOT NULL, "workspace_id" uuid, "suggestions_applied" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_resume_versions_resume_version" UNIQUE ("resume_id", "version"), CONSTRAINT "PK_resume_versions" PRIMARY KEY ("id"))`,
    );

    // ── cover_letters ──
    await queryRunner.query(
      `CREATE TABLE "cover_letters" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspace_id" uuid NOT NULL, "run_id" uuid, "version" integer NOT NULL DEFAULT '1', "tone" character varying NOT NULL DEFAULT 'professional', "length" character varying NOT NULL DEFAULT 'standard', "content" text NOT NULL, "word_count" integer NOT NULL, "is_current" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_cover_letters" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cover_letters_workspace_version" ON "cover_letters" ("workspace_id", "version")`,
    );

    // ── interview_questions ──
    await queryRunner.query(
      `CREATE TABLE "interview_questions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspace_id" uuid NOT NULL, "run_id" uuid NOT NULL, "type" character varying NOT NULL, "difficulty" character varying NOT NULL, "question" text NOT NULL, "ideal_answer" text NOT NULL, "framework" character varying, "why_asked" text NOT NULL, "based_on" text, "user_answer" text, "ai_feedback" text, "answer_score" integer, "answered_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_interview_questions" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_interview_questions_workspace" ON "interview_questions" ("workspace_id")`,
    );

    // ── learning_roadmaps ── one row per workspace, hence the unique column.
    await queryRunner.query(
      `CREATE TABLE "learning_roadmaps" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspace_id" uuid NOT NULL, "run_id" uuid NOT NULL, "items" jsonb NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_learning_roadmaps_workspace" UNIQUE ("workspace_id"), CONSTRAINT "PK_learning_roadmaps" PRIMARY KEY ("id"))`,
    );

    // ── company_research_cache ── global, keyed by normalised company name hash.
    await queryRunner.query(
      `CREATE TABLE "company_research_cache" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "company_hash" character varying NOT NULL, "company_name" character varying NOT NULL, "payload" jsonb NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_company_research_cache" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_company_research_cache_hash" ON "company_research_cache" ("company_hash")`,
    );

    // ── company_insights ── per-workspace copy of a cache payload (or a fresh one).
    await queryRunner.query(
      `CREATE TABLE "company_insights" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspace_id" uuid NOT NULL, "run_id" uuid NOT NULL, "company_name" character varying NOT NULL, "overview" text NOT NULL, "culture" jsonb NOT NULL, "talking_points" jsonb NOT NULL, "sources" jsonb NOT NULL, "confidence" character varying NOT NULL, "from_cache" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_company_insights_workspace" UNIQUE ("workspace_id"), CONSTRAINT "PK_company_insights" PRIMARY KEY ("id"))`,
    );

    // ── salary_estimates ──
    await queryRunner.query(
      `CREATE TABLE "salary_estimates" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspace_id" uuid NOT NULL, "run_id" uuid NOT NULL, "currency" character(3) NOT NULL, "p25" integer NOT NULL, "p50" integer NOT NULL, "p75" integer NOT NULL, "is_estimate" boolean NOT NULL DEFAULT true, "methodology" text NOT NULL, "factors" jsonb NOT NULL, "negotiation_tips" jsonb NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_salary_estimates_workspace" UNIQUE ("workspace_id"), CONSTRAINT "PK_salary_estimates" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "salary_estimates"`);
    await queryRunner.query(`DROP TABLE "company_insights"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_company_research_cache_hash"`,
    );
    await queryRunner.query(`DROP TABLE "company_research_cache"`);
    await queryRunner.query(`DROP TABLE "learning_roadmaps"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_interview_questions_workspace"`,
    );
    await queryRunner.query(`DROP TABLE "interview_questions"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cover_letters_workspace_version"`,
    );
    await queryRunner.query(`DROP TABLE "cover_letters"`);
    await queryRunner.query(`DROP TABLE "resume_versions"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ai_suggestions_workspace_status"`,
    );
    await queryRunner.query(`DROP TABLE "ai_suggestions"`);
  }
}
