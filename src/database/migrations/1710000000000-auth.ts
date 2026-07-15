import { MigrationInterface, QueryRunner } from 'typeorm';

export class Auth1710000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── hand-added: extensions must exist BEFORE the tables that use them ──
    // citext → case-insensitive unique email; uuid-ossp → uuid_generate_v4() defaults.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "citext"`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // ── everything below is what `migration:generate` wrote for you ──
    // (shown abbreviated — keep the generated SQL verbatim, only the extensions above are manual)
    await queryRunner.query(`CREATE TABLE "users" ( ... )`);
    await queryRunner.query(`CREATE TABLE "refresh_tokens" ( ... )`);
    await queryRunner.query(`CREATE TABLE "verification_tokens" ( ... )`);
    // ... generated indexes and foreign keys ...
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse order: drop tables (generated) first, then the extensions.
    await queryRunner.query(`DROP TABLE "verification_tokens"`);
    await queryRunner.query(`DROP TABLE "refresh_tokens"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP EXTENSION IF EXISTS "citext"`);
    await queryRunner.query(`DROP EXTENSION IF EXISTS "uuid-ossp"`);
  }
}
