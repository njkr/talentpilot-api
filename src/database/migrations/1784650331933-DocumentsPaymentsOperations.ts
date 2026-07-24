import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Generated via `migration:generate` against a live local Postgres, then hand-pruned:
 * the raw diff also included unrelated pre-existing drift between entity metadata and
 * the actual schema — index/constraint auto-naming differences (hand-written earlier
 * migrations used explicit names; TypeORM's generator wants its own hash-based names
 * for the same columns) and, most importantly, a DROP/ADD of `embeddings.embedding`
 * that would have silently destroyed every stored vector and changed the column from
 * `vector(1536)` to `character varying`. That mismatch is intentional (see that
 * entity's own comment — the column is raw-SQL-managed, `insert:false, update:false`,
 * and TypeORM's introspector doesn't understand the pgvector type) and existed before
 * this migration; none of it belongs here, so it was removed. What remains below is
 * exactly Sprint 9/10/11's actual schema change.
 */
export class DocumentsPaymentsOperations1784650331933 implements MigrationInterface {
  name = 'DocumentsPaymentsOperations1784650331933';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── generated_documents (Sprint 9) ──
    await queryRunner.query(
      `CREATE TABLE "generated_documents" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspace_id" uuid NOT NULL, "user_id" uuid NOT NULL, "type" character varying NOT NULL, "file_key" character varying, "file_size" integer, "filename" character varying NOT NULL, "resume_version" integer, "cover_letter_version" integer, "status" character varying NOT NULL DEFAULT 'queued', "error" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_93d5f4d6fdc3c0fcc5a7a3aedc2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b1e86142f72f1577035115cf68" ON "generated_documents"  ("workspace_id", "type") `,
    );

    // ── notifications + notification_preferences (Sprint 9) ──
    await queryRunner.query(
      `CREATE TABLE "notifications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "type" character varying NOT NULL, "title" character varying NOT NULL, "message" text NOT NULL, "data" jsonb NOT NULL DEFAULT '{}', "read_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6a72c3c0f683f6462415e653c3a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_310667f935698fcd8cb319113a" ON "notifications"  ("user_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "notification_preferences" ("user_id" uuid NOT NULL, "email_disabled" jsonb NOT NULL DEFAULT '[]', CONSTRAINT "PK_64c90edc7310c6be7c10c96f675" PRIMARY KEY ("user_id"))`,
    );

    // ── plans, subscriptions, webhook_events (Sprint 10) ──
    await queryRunner.query(
      `CREATE TABLE "plans" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "key" character varying NOT NULL, "name" character varying NOT NULL, "monthly_credits" integer NOT NULL, "max_resumes" integer NOT NULL, "max_workspaces" integer NOT NULL, "price_usd" numeric(8,2) NOT NULL, "stripe_price_id" character varying, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_81fbbbb81d6b241363f82c17b09" UNIQUE ("key"), CONSTRAINT "PK_3720521a81c7c24fe9b7202ba61" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "subscriptions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "stripe_customer_id" character varying, "stripe_subscription_id" character varying, "plan_key" character varying NOT NULL DEFAULT 'free', "status" character varying NOT NULL DEFAULT 'active', "current_period_end" TIMESTAMP WITH TIME ZONE, "cancel_at_period_end" boolean NOT NULL DEFAULT false, "last_event_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_d0a95ef8a28188364c546eb65c1" UNIQUE ("user_id"), CONSTRAINT "UQ_3a2d09d943f39912a01831a9272" UNIQUE ("stripe_subscription_id"), CONSTRAINT "PK_a87248d73155605cf782be9ee5e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7aa77f6636d26cac1b731cac3a" ON "subscriptions"  ("stripe_customer_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "webhook_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "event_id" character varying NOT NULL, "type" character varying NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_eca7d9af1d5bb2184a201ed250d" UNIQUE ("event_id"), CONSTRAINT "PK_4cba37e6a0acb5e1fc49c34ebfd" PRIMARY KEY ("id"))`,
    );

    // ── column additions (Sprint 10/11) ──
    await queryRunner.query(`ALTER TABLE "audit_logs" ADD "resource_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "credits_ledger" ADD "reference_type" character varying`,
    );

    // ── seed the plans table (Sprint 10) ──
    // Price ids are environment-specific (test-mode vs. live-mode Stripe accounts) —
    // seeded from env here rather than hardcoded, same reasoning as every other
    // environment-dependent value in this codebase. NULL is fine: PaymentsService
    // already 404s a checkout attempt for a plan with no price id rather than crashing.
    await queryRunner.query(
      `INSERT INTO "plans" ("key", "name", "monthly_credits", "max_resumes", "max_workspaces", "price_usd", "stripe_price_id") VALUES
        ('free', 'Free', 0, 3, 3, 0, NULL),
        ('pro', 'Pro', 200, 25, 100, 19.00, $1),
        ('ultimate', 'Ultimate', 1000, -1, -1, 49.00, $2)`,
      [
        process.env.STRIPE_PRICE_PRO ?? null,
        process.env.STRIPE_PRICE_ULTIMATE ?? null,
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "credits_ledger" DROP COLUMN "reference_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" DROP COLUMN "resource_id"`,
    );
    await queryRunner.query(`DROP TABLE "webhook_events"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7aa77f6636d26cac1b731cac3a"`,
    );
    await queryRunner.query(`DROP TABLE "subscriptions"`);
    await queryRunner.query(`DROP TABLE "plans"`);
    await queryRunner.query(`DROP TABLE "notification_preferences"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_310667f935698fcd8cb319113a"`,
    );
    await queryRunner.query(`DROP TABLE "notifications"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b1e86142f72f1577035115cf68"`,
    );
    await queryRunner.query(`DROP TABLE "generated_documents"`);
  }
}
