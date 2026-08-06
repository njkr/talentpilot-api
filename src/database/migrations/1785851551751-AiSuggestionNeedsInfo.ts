import { MigrationInterface, QueryRunner } from 'typeorm';

export class AiSuggestionNeedsInfo1785851551751 implements MigrationInterface {
  name = 'AiSuggestionNeedsInfo1785851551751';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ai_suggestions" ADD "missing_fact" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_suggestions" ADD "example_value" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ai_suggestions" DROP COLUMN "example_value"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_suggestions" DROP COLUMN "missing_fact"`,
    );
  }
}
