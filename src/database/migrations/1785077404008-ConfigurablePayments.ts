import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sprint 13: admin-editable plans/credit packs/referrals + a live-editable payment
 * config singleton. Hand-written, not generated — this isn't a pure schema diff, it
 * restructures real existing data on `plans` (price_usd → price_monthly_cents,
 * stripe_price_id → stripe_price_ids jsonb, max_resumes/max_workspaces → limits
 * jsonb), and this environment already has real Stripe test-mode data on that table
 * (pro/ultimate, set up directly against the Stripe API in an earlier session) that
 * must survive the migration, not just get a fresh default.
 */
export class ConfigurablePayments1785077404008 implements MigrationInterface {
  name = 'ConfigurablePayments1785077404008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── payment_config: singleton config row ──
    await queryRunner.query(`
      CREATE TABLE "payment_config" (
        "id" int NOT NULL DEFAULT 1,
        "signup_credit_grant" int NOT NULL DEFAULT 25,
        "referrer_reward" int NOT NULL DEFAULT 50,
        "referee_reward" int NOT NULL DEFAULT 25,
        "referral_qualifying_event" varchar NOT NULL DEFAULT 'first_analysis',
        "max_referral_rewards_per_user" int NOT NULL DEFAULT 20,
        "analyze_cost" int NOT NULL DEFAULT 21,
        "cover_letter_regen_cost" int NOT NULL DEFAULT 2,
        "interview_feedback_cost" int NOT NULL DEFAULT 1,
        "referrals_enabled" boolean NOT NULL DEFAULT true,
        "credit_packs_enabled" boolean NOT NULL DEFAULT true,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "updated_by" uuid,
        CONSTRAINT "PK_payment_config" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_payment_config_singleton" CHECK ("id" = 1)
      )
    `);
    // Seed from whatever SIGNUP_CREDIT_GRANT was actually set to in this environment
    // (falling back to the new schema default) — preserves current real behaviour
    // instead of silently resetting every existing environment to 25 on upgrade.
    await queryRunner.query(
      `INSERT INTO "payment_config" ("id", "signup_credit_grant") VALUES (1, $1)`,
      [Number(process.env.SIGNUP_CREDIT_GRANT ?? 25)],
    );

    // ── plans: restructure in place, preserving existing rows ──
    await queryRunner.query(`
      ALTER TABLE "plans"
        ADD COLUMN "description" text,
        ADD COLUMN "price_monthly_cents" int NOT NULL DEFAULT 0,
        ADD COLUMN "price_yearly_cents" int NOT NULL DEFAULT 0,
        ADD COLUMN "limits" jsonb,
        ADD COLUMN "stripe_product_id" varchar,
        ADD COLUMN "stripe_price_ids" jsonb NOT NULL DEFAULT '{}',
        ADD COLUMN "active" boolean NOT NULL DEFAULT true,
        ADD COLUMN "display_order" int NOT NULL DEFAULT 0
    `);
    // price_usd (numeric dollars) -> price_monthly_cents (int cents)
    await queryRunner.query(`
      UPDATE "plans" SET "price_monthly_cents" = ROUND("price_usd" * 100)
    `);
    // max_resumes/max_workspaces (flat columns) -> limits (jsonb)
    await queryRunner.query(`
      UPDATE "plans" SET "limits" = jsonb_build_object(
        'maxResumes', "max_resumes",
        'maxWorkspaces', "max_workspaces",
        'regenPerDay', -1
      )
    `);
    // stripe_price_id (flat, monthly-only) -> stripe_price_ids (jsonb, monthly+yearly)
    await queryRunner.query(`
      UPDATE "plans" SET "stripe_price_ids" = jsonb_build_object('monthly', "stripe_price_id")
      WHERE "stripe_price_id" IS NOT NULL
    `);
    // Backfill stripe_product_id for the two plans that already had a real Stripe
    // Price created directly against this environment's test-mode account (see this
    // session's Stripe checkout debugging) — StripeSyncService needs the PRODUCT id
    // too, which was never stored anywhere before this migration.
    await queryRunner.query(`
      UPDATE "plans" SET "stripe_product_id" = 'prod_Uwy1v59tEaZfOx' WHERE "key" = 'pro' AND "stripe_price_id" IS NOT NULL
    `);
    await queryRunner.query(`
      UPDATE "plans" SET "stripe_product_id" = 'prod_Uwy12UpzlcFwKX' WHERE "key" = 'ultimate' AND "stripe_price_id" IS NOT NULL
    `);
    await queryRunner.query(`
      UPDATE "plans" SET "limits" = '{"maxResumes":3,"maxWorkspaces":3,"regenPerDay":-1}' WHERE "limits" IS NULL
    `);
    await queryRunner.query(
      `ALTER TABLE "plans" ALTER COLUMN "limits" SET NOT NULL`,
    );
    await queryRunner.query(`
      ALTER TABLE "plans"
        DROP COLUMN "price_usd",
        DROP COLUMN "stripe_price_id",
        DROP COLUMN "max_resumes",
        DROP COLUMN "max_workspaces"
    `);

    // ── credit_packs ──
    await queryRunner.query(`
      CREATE TABLE "credit_packs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" varchar NOT NULL,
        "credits" int NOT NULL,
        "price_cents" int NOT NULL,
        "stripe_product_id" varchar,
        "stripe_price_id" varchar,
        "active" boolean NOT NULL DEFAULT true,
        "display_order" int NOT NULL DEFAULT 0,
        "best_value" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_credit_packs" PRIMARY KEY ("id")
      )
    `);

    // ── referrals ──
    await queryRunner.query(`
      CREATE TABLE "referrals" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "referrer_id" uuid NOT NULL,
        "referee_id" uuid NOT NULL,
        "referee_email" varchar,
        "status" varchar NOT NULL DEFAULT 'pending',
        "reward_granted" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "qualified_at" timestamptz,
        CONSTRAINT "PK_referrals" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_referrals_referee_id" UNIQUE ("referee_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_referrals_referrer_id" ON "referrals" ("referrer_id")`,
    );

    // ── users: referral code + who referred them ──
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "referral_code" varchar,
        ADD COLUMN "referred_by" uuid
    `);
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "UQ_users_referral_code" UNIQUE ("referral_code")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "UQ_users_referral_code"`,
    );
    await queryRunner.query(`
      ALTER TABLE "users" DROP COLUMN "referral_code", DROP COLUMN "referred_by"
    `);

    await queryRunner.query(`DROP INDEX "IDX_referrals_referrer_id"`);
    await queryRunner.query(`DROP TABLE "referrals"`);
    await queryRunner.query(`DROP TABLE "credit_packs"`);

    await queryRunner.query(`
      ALTER TABLE "plans"
        ADD COLUMN "price_usd" numeric(8,2) NOT NULL DEFAULT 0,
        ADD COLUMN "stripe_price_id" varchar,
        ADD COLUMN "max_resumes" int NOT NULL DEFAULT 3,
        ADD COLUMN "max_workspaces" int NOT NULL DEFAULT 3
    `);
    await queryRunner.query(`
      UPDATE "plans" SET
        "price_usd" = "price_monthly_cents" / 100.0,
        "stripe_price_id" = "stripe_price_ids"->>'monthly',
        "max_resumes" = ("limits"->>'maxResumes')::int,
        "max_workspaces" = ("limits"->>'maxWorkspaces')::int
    `);
    await queryRunner.query(`
      ALTER TABLE "plans"
        DROP COLUMN "description",
        DROP COLUMN "price_monthly_cents",
        DROP COLUMN "price_yearly_cents",
        DROP COLUMN "limits",
        DROP COLUMN "stripe_product_id",
        DROP COLUMN "stripe_price_ids",
        DROP COLUMN "active",
        DROP COLUMN "display_order"
    `);

    await queryRunner.query(`DROP TABLE "payment_config"`);
  }
}
