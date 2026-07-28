import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CreditLedger } from './entities/credit-ledger.entity';
import { CreditService } from './credit.service';
import { CreditsListener } from './credits.listener';
import { CreditsController } from './credits.controller';
import { PaymentConfigModule } from '../payments/config/payment-config.module';

@Module({
  imports: [TypeOrmModule.forFeature([CreditLedger]), PaymentConfigModule],
  controllers: [CreditsController],
  providers: [CreditService, CreditsListener],
  exports: [CreditService],
})
export class CreditsModule {}
