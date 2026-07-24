import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Generated via `migration:generate`, then hand-pruned exactly as
 * DocumentsPaymentsOperations1784650331933 was — the raw diff also included unrelated
 * pre-existing drift (index auto-naming, and a DROP/ADD of embeddings.embedding that
 * would destroy every stored vector; see that migration's own comment for why). None
 * of it belongs here. What remains is the one genuine schema change: subscriptions
 * gains a column so PaymentsService.reconcileAll() can detect a missed monthly
 * credit refill independently of subscription status drift.
 */
export class SubscriptionRefillTracking1784711685686 implements MigrationInterface {
  name = 'SubscriptionRefillTracking1784711685686';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "subscriptions" ADD "last_refill_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "subscriptions" DROP COLUMN "last_refill_at"`,
    );
  }
}
