import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Admin visibility into third-party integrations that had ZERO historical tracking before this:
 * Resend (email), Tavily (company research), Stripe, and S3. OpenAI is deliberately NOT included
 * here — it already has its own richer, actively-used token_usage table backing BudgetService's
 * daily spend limits, untouched by this migration. See src/integration-calls's own comments.
 */
export class IntegrationCalls1785244272581 implements MigrationInterface {
  name = 'IntegrationCalls1785244272581';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "integration_calls" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "provider" character varying NOT NULL, "operation" character varying NOT NULL, "success" boolean NOT NULL DEFAULT true, "error_type" character varying, "duration_ms" integer NOT NULL, "metadata" jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_integration_calls" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_integration_calls_provider_created_at" ON "integration_calls" ("provider", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_integration_calls_provider_created_at"`,
    );
    await queryRunner.query(`DROP TABLE "integration_calls"`);
  }
}
