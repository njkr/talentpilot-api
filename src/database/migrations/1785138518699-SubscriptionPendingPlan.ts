import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sprint 14: cancellation, end dates & plan switching. One genuine schema change —
 * subscriptions gains pending_plan_key, set when a downgrade is scheduled for the
 * next renewal (PaymentsService.switchPlan()) and cleared once
 * onSubscriptionUpdated() sees Stripe's Subscription Schedule actually apply it.
 * `credits_ledger.reason` is a plain varchar (no pg enum — see that entity's own
 * comment), so the new 'plan_upgrade' reason needs no migration at all.
 */
export class SubscriptionPendingPlan1785138518699 implements MigrationInterface {
  name = 'SubscriptionPendingPlan1785138518699';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "subscriptions" ADD "pending_plan_key" varchar`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "subscriptions" DROP COLUMN "pending_plan_key"`,
    );
  }
}
