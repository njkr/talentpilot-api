import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Plan } from './entities/plan.entity';
import { Subscription } from './entities/subscription.entity';
import { WebhookEvent } from './entities/webhook-event.entity';
import { User } from '../auth/entities/user.entity';
import { CreditsModule } from '../credits/credits.module';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Plan, Subscription, WebhookEvent, User]),
    BullModule.registerQueue({ name: 'emails' }), // payment-failed notification
    CreditsModule,
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
