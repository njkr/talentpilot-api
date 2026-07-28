import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationCall } from './entities/integration-call.entity';
import { IntegrationCallRecorderService } from './integration-call-recorder.service';

// A dedicated leaf module (TypeORM + the recorder, nothing else) — same reasoning as
// PaymentConfigModule: this is imported by every module with a third-party integration to
// instrument (notifications, company/Tavily, storage, payments, gdpr) AS WELL AS by AdminModule
// (to read the same table back out). Keeping it dependency-free avoids any risk of those two
// directions ever forming a cycle.
@Module({
  imports: [TypeOrmModule.forFeature([IntegrationCall])],
  providers: [IntegrationCallRecorderService],
  exports: [TypeOrmModule, IntegrationCallRecorderService],
})
export class IntegrationCallsModule {}
