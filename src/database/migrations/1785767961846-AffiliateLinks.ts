import { MigrationInterface, QueryRunner } from 'typeorm';

export class AffiliateLinks1785767961846 implements MigrationInterface {
  name = 'AffiliateLinks1785767961846';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "affiliate_links" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "resource_type" character varying NOT NULL, "keyword" character varying, "url_template" text NOT NULL, "label" character varying NOT NULL, "active" boolean NOT NULL DEFAULT true, "priority" integer NOT NULL DEFAULT 0, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_affiliate_links" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "one_default_per_resource_type" ON "affiliate_links" ("resource_type") WHERE "keyword" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."one_default_per_resource_type"`,
    );
    await queryRunner.query(`DROP TABLE "affiliate_links"`);
  }
}
