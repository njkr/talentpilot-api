import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { User } from 'src/auth/entities/user.entity';
import { CursorQueryDto } from 'src/common/dto/cursor-query.dto';
import { ApiDataResponse } from 'src/common/swagger/api-response.decorator';
import { NotificationsService } from './notifications.service';
import { NotificationResponse } from './dto/notification-response.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';

@ApiTags('notifications')
@ApiBearerAuth('access-token')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List notifications, newest first' })
  @ApiDataResponse(200, NotificationResponse, 'A page of notifications.', {
    isArray: true,
  })
  async list(@CurrentUser() user: User, @Query() q: CursorQueryDto) {
    const { data, hasMore, nextCursor } = await this.notifications.list(
      user.id,
      q,
    );
    return {
      data: data.map((n) => new NotificationResponse(n)),
      hasMore,
      nextCursor,
    };
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Badge count for the bell icon' })
  async unreadCount(@CurrentUser() user: User) {
    return { count: await this.notifications.unreadCount(user.id) };
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark one notification read' })
  async markRead(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.notifications.markRead(user.id, id);
    return { marked: true };
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark every notification read' })
  async markAllRead(@CurrentUser() user: User) {
    await this.notifications.markAllRead(user.id);
    return { marked: true };
  }

  @Get('preferences')
  @ApiOperation({ summary: 'Notification types currently muted from email' })
  async getPreferences(@CurrentUser() user: User) {
    return { emailDisabled: await this.notifications.getPreferences(user.id) };
  }

  @Put('preferences')
  @ApiOperation({
    summary: 'Replace the set of email-muted notification types',
  })
  async setPreferences(
    @CurrentUser() user: User,
    @Body() dto: UpdatePreferencesDto,
  ) {
    await this.notifications.setPreferences(user.id, dto.emailDisabled);
    return { emailDisabled: dto.emailDisabled };
  }
}
