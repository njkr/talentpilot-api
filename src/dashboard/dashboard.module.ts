import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Resume } from '../resumes/entities/resume.entity';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { CreditsModule } from '../credits/credits.module';
import { PaymentsModule } from '../payments/payments.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentConfigModule } from '../payments/config/payment-config.module';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Resume, Workspace]),
    CreditsModule,
    PaymentsModule,
    NotificationsModule,
    PaymentConfigModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
