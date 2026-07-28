import { MigrationInterface, QueryRunner } from 'typeorm';

/** Parity with Plan, which already has a description column — CreditPack never did. */
export class CreditPackDescription1785140067436 implements MigrationInterface {
  name = 'CreditPackDescription1785140067436';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "credit_packs" ADD "description" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "credit_packs" DROP COLUMN "description"`,
    );
  }
}
