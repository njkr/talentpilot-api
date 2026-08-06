import { MigrationInterface, QueryRunner } from 'typeorm';

export class PaymentConfigRescoreCost1785852316796 implements MigrationInterface {
  name = 'PaymentConfigRescoreCost1785852316796';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payment_config" ADD "rescore_cost" int NOT NULL DEFAULT 5`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payment_config" DROP COLUMN "rescore_cost"`,
    );
  }
}
