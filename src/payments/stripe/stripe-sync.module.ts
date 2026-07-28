import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Plan } from '../entities/plan.entity';
import { CreditPack } from '../entities/credit-pack.entity';
import { StripeSyncService } from './stripe-sync.service';
import { IntegrationCallsModule } from '../../integration-calls/integration-calls.module';

// Its own module (not folded into PaymentsModule) so both PaymentsModule (credit
// packs' checkout needs pack.active/stripePriceId, kept in sync here) and
// AdminPaymentsModule (the admin CRUD endpoints that trigger a sync) can import it
// without importing each other.
@Module({
  imports: [
    TypeOrmModule.forFeature([Plan, CreditPack]),
    IntegrationCallsModule,
  ],
  providers: [StripeSyncService],
  exports: [StripeSyncService],
})
export class StripeSyncModule {}
