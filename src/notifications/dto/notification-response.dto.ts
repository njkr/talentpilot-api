import { ApiProperty } from '@nestjs/swagger';
import { Notification } from '../entities/notification.entity';

export class NotificationResponse {
  @ApiProperty() id: string;
  @ApiProperty() type: string;
  @ApiProperty() title: string;
  @ApiProperty() message: string;
  @ApiProperty({ type: Object }) data: Record<string, unknown>;
  @ApiProperty({ nullable: true }) readAt: Date | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;

  constructor(n: Notification) {
    Object.assign(this, {
      id: n.id,
      type: n.type,
      title: n.title,
      message: n.message,
      data: n.data,
      readAt: n.readAt,
      createdAt: n.createdAt,
    });
  }
}
