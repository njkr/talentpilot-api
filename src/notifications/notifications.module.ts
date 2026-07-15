import { Module } from '@nestjs/common';
import { EmailProcessor } from './email.processor';
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [BullModule.registerQueue({ name: 'emails' })],
  providers: [EmailProcessor], // the @Processor from §10 — runs in the WORKER process
})
export class NotificationsModule {}
