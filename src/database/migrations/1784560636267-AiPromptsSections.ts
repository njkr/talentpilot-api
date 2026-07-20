import { MigrationInterface, QueryRunner } from 'typeorm';

export class AiPromptsSections1784560636267 implements MigrationInterface {
  name = 'AiPromptsSections1784560636267';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "resume_sections" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "resume_id" uuid NOT NULL, "version" integer NOT NULL DEFAULT '1', "section_type" character varying NOT NULL, "content" jsonb NOT NULL, "order_index" integer NOT NULL DEFAULT '0', "confidence" numeric(3,2), "ai_generated" boolean NOT NULL DEFAULT true, "edited_by_user" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ddf1954682d00685184650d595c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8009aa979ae75c90fed27992eb" ON "resume_sections"  ("resume_id", "version") `,
    );
    await queryRunner.query(
      `CREATE TABLE "prompt_templates" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "key" character varying NOT NULL, "version" integer NOT NULL, "model" character varying NOT NULL, "temperature" numeric(3,2) NOT NULL DEFAULT '0.1', "max_tokens" integer NOT NULL DEFAULT '4096', "system_template" text NOT NULL, "user_template" text NOT NULL, "variables" jsonb NOT NULL DEFAULT '[]', "schema_key" character varying NOT NULL, "is_active" boolean NOT NULL DEFAULT false, "change_note" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_ba18a132c956fe6fabe0e6532ed" UNIQUE ("key", "version"), CONSTRAINT "PK_d8621cc428ff586db3e3a8f5b74" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "one_active_version_per_key" ON "prompt_templates"  ("key") WHERE is_active = true`,
    );
    await queryRunner.query(
      `CREATE TABLE "token_usage" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid, "workspace_id" uuid, "run_id" uuid, "step_name" character varying, "feature" character varying NOT NULL, "model" character varying NOT NULL, "prompt_key" character varying, "prompt_version" integer, "prompt_tokens" integer NOT NULL, "completion_tokens" integer NOT NULL, "cached_tokens" integer NOT NULL DEFAULT '0', "cost_usd" numeric(12,6) NOT NULL, "duration_ms" integer NOT NULL, "attempts" integer NOT NULL DEFAULT '1', "success" boolean NOT NULL DEFAULT true, "error_type" character varying, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_b85b17103d77d9695632654729d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_02d37089b7317d09e6ff9475b7" ON "token_usage"  ("created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9d87af3986f52a77b8ec177f84" ON "token_usage"  ("user_id", "created_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "resume_sections" ADD CONSTRAINT "FK_2a039da8150d11de52ecfe14c7f" FOREIGN KEY ("resume_id") REFERENCES "resumes"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "resume_sections" DROP CONSTRAINT "FK_2a039da8150d11de52ecfe14c7f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9d87af3986f52a77b8ec177f84"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_02d37089b7317d09e6ff9475b7"`,
    );
    await queryRunner.query(`DROP TABLE "token_usage"`);
    await queryRunner.query(`DROP INDEX "public"."one_active_version_per_key"`);
    await queryRunner.query(`DROP TABLE "prompt_templates"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8009aa979ae75c90fed27992eb"`,
    );
    await queryRunner.query(`DROP TABLE "resume_sections"`);
  }
}
