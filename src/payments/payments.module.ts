import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Plan } from './entities/plan.entity';
import { Subscription } from './entities/subscription.entity';
import { WebhookEvent } from './entities/webhook-event.entity';
import { CreditPack } from './entities/credit-pack.entity';
import { User } from '../auth/entities/user.entity';
import { CreditsModule } from '../credits/credits.module';
import { AuditModule } from '../audit/audit.module';
import { PaymentConfigModule } from './config/payment-config.module';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { PlansController } from './plans.controller';
import { CreditPacksService } from './credit-packs.service';
import { CreditPacksController } from './credit-packs.controller';
import { IntegrationCallsModule } from '../integration-calls/integration-calls.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Plan,
      Subscription,
      WebhookEvent,
      CreditPack,
      User,
    ]),
    BullModule.registerQueue({ name: 'emails' }), // payment-failed notification
    CreditsModule,
    AuditModule,
    PaymentConfigModule, // credit-pack feature flag
    IntegrationCallsModule,
  ],
  controllers: [PaymentsController, PlansController, CreditPacksController],
  providers: [PaymentsService, CreditPacksService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
