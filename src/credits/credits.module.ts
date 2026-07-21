import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CreditLedger } from './entities/credit-ledger.entity';
import { CreditService } from './credit.service';
import { CreditsListener } from './credits.listener';

@Module({
  imports: [TypeOrmModule.forFeature([CreditLedger])],
  providers: [CreditService, CreditsListener],
  exports: [CreditService],
})
export class CreditsModule {}
