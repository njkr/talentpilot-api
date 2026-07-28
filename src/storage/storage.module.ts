import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { IntegrationCallsModule } from '../integration-calls/integration-calls.module';

@Module({
  imports: [IntegrationCallsModule],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
