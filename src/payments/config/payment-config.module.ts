import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentConfig } from '../entities/payment-config.entity';
import { PaymentConfigService } from './payment-config.service';
import { AuditModule } from '../../audit/audit.module';

// Deliberately its own small module, not folded into PaymentsModule: it's imported by
// every module whose credit costs now read from here (workspaces, cover-letter,
// interview, credits) as well as by payments/referrals themselves. A dependency this
// widely shared needs to stay minimal — TypeORM + audit logging, nothing else — so
// none of those consumers pull in Stripe or the rest of the payments graph.
@Module({
  imports: [TypeOrmModule.forFeature([PaymentConfig]), AuditModule],
  providers: [PaymentConfigService],
  exports: [PaymentConfigService],
})
export class PaymentConfigModule {}
