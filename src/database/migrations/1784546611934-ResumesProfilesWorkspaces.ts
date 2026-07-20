import { MigrationInterface, QueryRunner } from 'typeorm';

// Auto-generated (`pnpm m:gen`). Alongside the new profiles/resumes/workspaces
// tables, this also renames the Sprint 1 constraints/indexes on
// users/refresh_tokens/verification_tokens/audit_logs from the hand-picked
// names in the original migration to TypeORM's default hash-based names —
// same constraints, just reconciling a naming drift so future `m:gen` runs
// stay quiet. Purely a rename; no data is touched.
export class ResumesProfilesWorkspaces1784546611934 implements MigrationInterface {
  name = 'ResumesProfilesWorkspaces1784546611934';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" DROP CONSTRAINT "FK_refresh_tokens_user_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "verification_tokens" DROP CONSTRAINT "FK_verification_tokens_user_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_users_email"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_refresh_tokens_user_id"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_refresh_tokens_family_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_verification_tokens_user_id_type"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_audit_logs_user_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_audit_logs_action"`);
    await queryRunner.query(
      `CREATE TABLE "profiles" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "first_name" character varying, "last_name" character varying, "phone" character varying, "linkedin" character varying, "github" character varying, "portfolio" character varying, "country" character varying, "city" character varying, "timezone" character varying, "years_experience" integer, "target_role" character varying, "salary_expectation" integer, "salary_currency" character(3), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_9e432b7df0d182f8d292902d1a2" UNIQUE ("user_id"), CONSTRAINT "REL_9e432b7df0d182f8d292902d1a" UNIQUE ("user_id"), CONSTRAINT "PK_8e520eb4da7dc01d0e190447c8e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "resumes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "title" character varying NOT NULL, "original_file_key" character varying NOT NULL, "original_filename" character varying NOT NULL, "mime_type" character varying NOT NULL, "file_size" integer NOT NULL, "page_count" integer, "raw_text" text, "word_count" integer, "language" character(2), "content_hash" character varying, "current_version" integer NOT NULL DEFAULT '1', "status" character varying NOT NULL DEFAULT 'uploaded', "parse_error" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_9c8677802096d6baece48429d2e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4e209668cbe6b7a037a895723c" ON "resumes"  ("user_id", "content_hash") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dce6e1ce26d348e602f56fa636" ON "resumes"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "workspaces" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "resume_id" uuid NOT NULL, "name" character varying NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_098656ae401f3e1a4586f47fd8e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_415d27b94b4128cf22ce76301c" ON "workspaces"  ("resume_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_78512d762073bf8cb3fc88714c" ON "workspaces"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_97672ac88f789774dd47f7c8be" ON "users"  ("email") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d5e27da0cd39bc3bb2811fc8ba" ON "refresh_tokens"  ("family_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3ddc983c5f7bcf132fd8732c3f" ON "refresh_tokens"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7206f3188618d4f2070dec26cc" ON "verification_tokens"  ("user_id", "type") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cee5459245f652b75eb2759b4c" ON "audit_logs"  ("action") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bd2726fd31b35443f2245b93ba" ON "audit_logs"  ("user_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" ADD CONSTRAINT "FK_3ddc983c5f7bcf132fd8732c3f4" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "verification_tokens" ADD CONSTRAINT "FK_31d2079dc4079b80517d31cf4f2" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "profiles" ADD CONSTRAINT "FK_9e432b7df0d182f8d292902d1a2" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "resumes" ADD CONSTRAINT "FK_dce6e1ce26d348e602f56fa6363" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspaces" ADD CONSTRAINT "FK_78512d762073bf8cb3fc88714c1" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspaces" ADD CONSTRAINT "FK_415d27b94b4128cf22ce76301c1" FOREIGN KEY ("resume_id") REFERENCES "resumes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "workspaces" DROP CONSTRAINT "FK_415d27b94b4128cf22ce76301c1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspaces" DROP CONSTRAINT "FK_78512d762073bf8cb3fc88714c1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "resumes" DROP CONSTRAINT "FK_dce6e1ce26d348e602f56fa6363"`,
    );
    await queryRunner.query(
      `ALTER TABLE "profiles" DROP CONSTRAINT "FK_9e432b7df0d182f8d292902d1a2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "verification_tokens" DROP CONSTRAINT "FK_31d2079dc4079b80517d31cf4f2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" DROP CONSTRAINT "FK_3ddc983c5f7bcf132fd8732c3f4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bd2726fd31b35443f2245b93ba"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cee5459245f652b75eb2759b4c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7206f3188618d4f2070dec26cc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3ddc983c5f7bcf132fd8732c3f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d5e27da0cd39bc3bb2811fc8ba"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_97672ac88f789774dd47f7c8be"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_78512d762073bf8cb3fc88714c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_415d27b94b4128cf22ce76301c"`,
    );
    await queryRunner.query(`DROP TABLE "workspaces"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dce6e1ce26d348e602f56fa636"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4e209668cbe6b7a037a895723c"`,
    );
    await queryRunner.query(`DROP TABLE "resumes"`);
    await queryRunner.query(`DROP TABLE "profiles"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_action" ON "audit_logs" USING btree ("action") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_user_id" ON "audit_logs" USING btree ("user_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_verification_tokens_user_id_type" ON "verification_tokens" USING btree ("type", "user_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_refresh_tokens_family_id" ON "refresh_tokens" USING btree ("family_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_refresh_tokens_user_id" ON "refresh_tokens" USING btree ("user_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_users_email" ON "users" USING btree ("email") `,
    );
    await queryRunner.query(
      `ALTER TABLE "verification_tokens" ADD CONSTRAINT "FK_verification_tokens_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" ADD CONSTRAINT "FK_refresh_tokens_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
