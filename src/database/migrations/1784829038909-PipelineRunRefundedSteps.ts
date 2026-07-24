import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Generated via `migration:generate`, then hand-pruned exactly as the two migrations
 * before it — the raw diff again included the same unrelated pre-existing drift
 * (index auto-naming, and a DROP/ADD of embeddings.embedding that would destroy every
 * stored vector; see DocumentsPaymentsOperations1784650331933's own comment for why
 * none of that belongs in a migration). What remains is the one genuine schema
 * change: pipeline_runs gains a column tracking which steps have ALREADY been
 * refunded across every attempt of a run, fixing a real bug where retrying a
 * deterministically-failing run (the same step failing identically every time)
 * refunded that step's credit weight again on every single retry, unbounded.
 */
export class PipelineRunRefundedSteps1784829038909 implements MigrationInterface {
  name = 'PipelineRunRefundedSteps1784829038909';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "pipeline_runs" ADD "refunded_steps" jsonb NOT NULL DEFAULT '[]'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "pipeline_runs" DROP COLUMN "refunded_steps"`,
    );
  }
}
