import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CreditLedger } from './entities/credit-ledger.entity';
import { CreditService } from './credit.service';
import { CreditsListener } from './credits.listener';
import { CreditsController } from './credits.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CreditLedger])],
  controllers: [CreditsController],
  providers: [CreditService, CreditsListener],
  exports: [CreditService],
})
export class CreditsModule {}
