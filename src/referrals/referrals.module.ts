import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Referral } from './entities/referral.entity';
import { User } from '../auth/entities/user.entity';
import { ReferralsService } from './referrals.service';
import { ReferralsController } from './referrals.controller';
import { ReferralsListener } from './referrals.listener';
import { PaymentConfigModule } from '../payments/config/payment-config.module';
import { CreditsModule } from '../credits/credits.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Referral, User]),
    PaymentConfigModule,
    CreditsModule,
    NotificationsModule,
  ],
  controllers: [ReferralsController],
  providers: [ReferralsService, ReferralsListener],
  exports: [ReferralsService],
})
export class ReferralsModule {}
