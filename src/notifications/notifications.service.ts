import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { IsNull, Repository } from 'typeorm';
import { Notification } from './entities/notification.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import { User } from '../auth/entities/user.entity';
import { CursorQueryDto } from '../common/dto/cursor-query.dto';
import { decodeCursor, encodeCursor } from '../common/utils/cursor.util';

export interface CreateNotificationInput {
  type: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
}

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    @InjectRepository(NotificationPreference)
    private readonly prefs: Repository<NotificationPreference>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectQueue('emails') private readonly emails: Queue,
  ) {}

  async create(
    userId: string,
    n: CreateNotificationInput,
  ): Promise<Notification> {
    const row = await this.notifications.save(
      this.notifications.create({ ...n, userId, data: n.data ?? {} }),
    );

    if (await this.emailEnabledFor(userId, n.type)) {
      const user = await this.users.findOne({ where: { id: userId } });
      // A notification about a user whose account no longer exists (a race with
      // account deletion) should not crash the caller — just skip the email.
      if (user) {
        await this.emails.add('send', {
          to: user.email,
          template: 'notification',
          vars: { title: n.title, message: n.message },
        });
      }
    }
    return row;
  }

  async list(userId: string, q: CursorQueryDto) {
    const after = decodeCursor(q.cursor);
    const qb = this.notifications
      .createQueryBuilder('n')
      .where('n.user_id = :userId', { userId })
      .orderBy('n.created_at', 'DESC')
      .addOrderBy('n.id', 'DESC')
      .take(q.limit + 1);
    if (after) {
      qb.andWhere('(n.created_at, n.id) < (:c, :i)', {
        c: after.createdAt,
        i: after.id,
      });
    }
    const rows = await qb.getMany();
    const hasMore = rows.length > q.limit;
    const data = hasMore ? rows.slice(0, q.limit) : rows;
    return {
      data,
      hasMore,
      nextCursor: hasMore ? encodeCursor(data.at(-1)!) : null,
    };
  }

  async unreadCount(userId: string): Promise<number> {
    return this.notifications.count({ where: { userId, readAt: IsNull() } });
  }

  /** Scoped by userId in the WHERE, not fetch-then-compare — a foreign id is a silent no-op. */
  async markRead(userId: string, id: string): Promise<void> {
    await this.notifications.update({ id, userId }, { readAt: new Date() });
  }

  async markAllRead(userId: string): Promise<void> {
    await this.notifications
      .createQueryBuilder()
      .update()
      .set({ readAt: new Date() })
      .where('user_id = :userId AND read_at IS NULL', { userId })
      .execute();
  }

  async getPreferences(userId: string): Promise<string[]> {
    const row = await this.prefs.findOne({ where: { userId } });
    return row?.emailDisabled ?? [];
  }

  async setPreferences(userId: string, emailDisabled: string[]): Promise<void> {
    await this.prefs.upsert(
      { userId, emailDisabled },
      { conflictPaths: ['userId'] },
    );
  }

  private async emailEnabledFor(
    userId: string,
    type: string,
  ): Promise<boolean> {
    const disabled = await this.getPreferences(userId);
    return !disabled.includes(type);
  }
}
