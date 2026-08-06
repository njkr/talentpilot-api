import { MigrationInterface, QueryRunner } from 'typeorm';

export class AtsReportResumeVersion1785852191736 implements MigrationInterface {
  name = 'AtsReportResumeVersion1785852191736';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ats_reports" ADD "resume_version" integer NOT NULL DEFAULT 1`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ats_reports" DROP COLUMN "resume_version"`,
    );
  }
}
