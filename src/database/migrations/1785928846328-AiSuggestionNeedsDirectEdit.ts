import { MigrationInterface, QueryRunner } from 'typeorm';

export class AiSuggestionNeedsDirectEdit1785928846328 implements MigrationInterface {
  name = 'AiSuggestionNeedsDirectEdit1785928846328';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ai_suggestions" ADD "needs_direct_edit" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ai_suggestions" DROP COLUMN "needs_direct_edit"`,
    );
  }
}
