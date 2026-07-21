import { MigrationInterface, QueryRunner } from 'typeorm';

export class PipelineCreditsAts1784617999729 implements MigrationInterface {
  name = 'PipelineCreditsAts1784617999729';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "credits_ledger" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "amount" integer NOT NULL, "reason" character varying NOT NULL, "reference_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_327519777f36f7355d70d1f4b04" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d2d6bd4503ff819412a6cc41e1" ON "credits_ledger"  ("user_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "pipeline_runs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspace_id" uuid NOT NULL, "user_id" uuid NOT NULL, "trigger" character varying NOT NULL DEFAULT 'full_analyze', "status" character varying NOT NULL DEFAULT 'queued', "idempotency_key" character varying NOT NULL, "steps_total" integer NOT NULL DEFAULT '0', "steps_completed" integer NOT NULL DEFAULT '0', "progress" integer NOT NULL DEFAULT '0', "current_step" character varying, "credits_charged" integer NOT NULL DEFAULT '0', "credits_refunded" integer NOT NULL DEFAULT '0', "total_cost_usd" numeric(12,6) NOT NULL DEFAULT '0', "error" text, "failed_steps" jsonb NOT NULL DEFAULT '[]', "resume_version" integer NOT NULL, "queued_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), "started_at" TIMESTAMP WITH TIME ZONE, "finished_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_115546f9f47f9a2f084c491cfc9" UNIQUE ("idempotency_key"), CONSTRAINT "PK_485786394df8fcdcbdbcdaedda3" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1135d05381ce4aaf68c552a01e" ON "pipeline_runs"  ("workspace_id", "created_at") `,
    );
    /**
     * "One active run per workspace" CANNOT be enforced in the service layer. Two
     * requests 5ms apart both SELECT "no active run", both pass the check, both
     * INSERT — two pipelines, double the AI spend, duplicate artifacts. A partial
     * unique index makes it a database invariant: the second INSERT fails with
     * 23505, which WorkspacesService.analyze() translates into a clean 409.
     */
    await queryRunner.query(`
      CREATE UNIQUE INDEX "one_active_run_per_workspace"
        ON "pipeline_runs" ("workspace_id")
        WHERE status IN ('queued', 'running')
    `);
    await queryRunner.query(
      `CREATE TABLE "pipeline_steps" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "run_id" uuid NOT NULL, "name" character varying NOT NULL, "status" character varying NOT NULL DEFAULT 'pending', "attempt" integer NOT NULL DEFAULT '0', "output_ref" character varying, "cost_usd" numeric(12,6) NOT NULL DEFAULT '0', "error" text, "error_type" character varying, "started_at" TIMESTAMP WITH TIME ZONE, "finished_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_779803f7c7d2d017636b7847705" UNIQUE ("run_id", "name"), CONSTRAINT "PK_dd17251e8708b56eef5996ec030" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8943a54f017d614935242c79ab" ON "pipeline_steps"  ("run_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ats_reports" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspace_id" uuid NOT NULL, "run_id" uuid NOT NULL, "overall_score" integer NOT NULL, "keyword_score" integer NOT NULL, "semantic_score" integer NOT NULL, "experience_score" integer NOT NULL, "education_score" integer, "project_score" integer NOT NULL, "format_score" integer NOT NULL, "grammar_score" integer NOT NULL, "score_breakdown" jsonb NOT NULL, "summary" text NOT NULL, "strengths" jsonb NOT NULL, "weaknesses" jsonb NOT NULL, "recommendations" jsonb NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_4bde747a71e2a0ccacaca975ffc" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1353e6d1afcdb98cafafe40120" ON "ats_reports"  ("workspace_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "keyword_matches" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "ats_report_id" uuid NOT NULL, "keyword" character varying NOT NULL, "canonical" character varying, "category" character varying NOT NULL, "importance" character varying NOT NULL, "status" character varying NOT NULL, "evidence" text, "found_in" jsonb NOT NULL DEFAULT '[]', "suggestion" text, CONSTRAINT "PK_077cbd13fc8176a74a2724255b5" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3d757f0650f2dc4e0ccee9bc11" ON "keyword_matches"  ("ats_report_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "workspaces" ADD "job_description_id" uuid NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspaces" ADD "status" character varying NOT NULL DEFAULT 'created'`,
    );
    await queryRunner.query(`ALTER TABLE "workspaces" ADD "last_run_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "workspaces" ADD "analyzed_resume_version" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspaces" ADD "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspaces" ADD "deleted_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3c3765d7add46d330d288c86d5" ON "workspaces"  ("job_description_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "workspaces" ADD CONSTRAINT "FK_3c3765d7add46d330d288c86d55" FOREIGN KEY ("job_description_id") REFERENCES "job_descriptions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "pipeline_steps" ADD CONSTRAINT "FK_8943a54f017d614935242c79abd" FOREIGN KEY ("run_id") REFERENCES "pipeline_runs"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "keyword_matches" ADD CONSTRAINT "FK_3d757f0650f2dc4e0ccee9bc118" FOREIGN KEY ("ats_report_id") REFERENCES "ats_reports"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "keyword_matches" DROP CONSTRAINT "FK_3d757f0650f2dc4e0ccee9bc118"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pipeline_steps" DROP CONSTRAINT "FK_8943a54f017d614935242c79abd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspaces" DROP CONSTRAINT "FK_3c3765d7add46d330d288c86d55"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3c3765d7add46d330d288c86d5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspaces" DROP COLUMN "deleted_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspaces" DROP COLUMN "updated_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspaces" DROP COLUMN "analyzed_resume_version"`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspaces" DROP COLUMN "last_run_id"`,
    );
    await queryRunner.query(`ALTER TABLE "workspaces" DROP COLUMN "status"`);
    await queryRunner.query(
      `ALTER TABLE "workspaces" DROP COLUMN "job_description_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3d757f0650f2dc4e0ccee9bc11"`,
    );
    await queryRunner.query(`DROP TABLE "keyword_matches"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1353e6d1afcdb98cafafe40120"`,
    );
    await queryRunner.query(`DROP TABLE "ats_reports"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8943a54f017d614935242c79ab"`,
    );
    await queryRunner.query(`DROP TABLE "pipeline_steps"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1135d05381ce4aaf68c552a01e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."one_active_run_per_workspace"`,
    );
    await queryRunner.query(`DROP TABLE "pipeline_runs"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d2d6bd4503ff819412a6cc41e1"`,
    );
    await queryRunner.query(`DROP TABLE "credits_ledger"`);
  }
}
