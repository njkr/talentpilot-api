import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { EmailProcessor } from './email.processor';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { Notification } from './entities/notification.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import { User } from '../auth/entities/user.entity';

// Imported by BOTH the API process (NotificationsController + NotificationsService.create()
// enqueuing emails) and the worker (EmailProcessor actually consuming them, plus
// PipelineNotificationListener elsewhere calling NotificationsService.create() directly).
// EmailProcessor being present here even in the API process's DI graph is a pre-existing
// Sprint 1 characteristic (registerQueue is needed either way for @InjectQueue to resolve);
// harmless duplication, not something this sprint changes.
@Module({
  imports: [
    BullModule.registerQueue({ name: 'emails' }),
    TypeOrmModule.forFeature([Notification, NotificationPreference, User]),
  ],
  controllers: [NotificationsController],
  providers: [EmailProcessor, NotificationsService], // the @Processor from §10 — runs in the WORKER process
  exports: [NotificationsService],
})
export class NotificationsModule {}
