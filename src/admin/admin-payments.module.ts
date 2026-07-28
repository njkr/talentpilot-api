import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Plan } from '../payments/entities/plan.entity';
import { CreditPack } from '../payments/entities/credit-pack.entity';
import { AdminModule } from './admin.module';
import { AuditModule } from '../audit/audit.module';
import { PaymentConfigModule } from '../payments/config/payment-config.module';
import { StripeSyncModule } from '../payments/stripe/stripe-sync.module';
import { ReferralsModule } from '../referrals/referrals.module';
import { AdminPlansController } from './admin-plans.controller';
import { AdminCreditPacksController } from './admin-credit-packs.controller';
import { AdminPaymentConfigController } from './admin-payment-config.controller';
import { AdminReferralsController } from './admin-referrals.controller';

// Separate from AdminModule itself: these 4 controllers pull in the whole
// payments/Stripe/referrals graph, which AdminModule's existing surface (run
// inspector, DLQ, prompts, audit) has no business depending on. Imports AdminModule
// only for AdminGuard (exported specifically for this).
@Module({
  imports: [
    TypeOrmModule.forFeature([Plan, CreditPack]),
    AdminModule,
    AuditModule,
    PaymentConfigModule,
    StripeSyncModule,
    ReferralsModule,
  ],
  controllers: [
    AdminPlansController,
    AdminCreditPacksController,
    AdminPaymentConfigController,
    AdminReferralsController,
  ],
})
export class AdminPaymentsModule {}
