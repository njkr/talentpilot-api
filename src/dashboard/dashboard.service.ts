import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Redis } from 'ioredis';
import { Env } from '../config/config.module';
import { Resume } from '../resumes/entities/resume.entity';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { CreditService } from '../credits/credit.service';
import { PaymentsService } from '../payments/payments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DashboardOverviewResponse } from './dto/dashboard-overview.dto';

const CACHE_TTL_SEC = 30;

/**
 * Everything a dashboard needs, in ONE round-trip from the client's perspective. The
 * 6 sources below are fetched in parallel (Promise.all) rather than sequentially —
 * none depends on another's result — and the assembled result is cached in Redis
 * briefly. A dashboard is read constantly (every page load, every poll) but changes
 * slowly; without the cache, a page refresh storm turns into 6x the DB load per hit.
 */
@Injectable()
export class DashboardService implements OnModuleInit, OnModuleDestroy {
  private redis!: Redis;

  constructor(
    private readonly env: Env,
    @InjectRepository(Resume) private readonly resumes: Repository<Resume>,
    @InjectRepository(Workspace)
    private readonly workspaces: Repository<Workspace>,
    private readonly credits: CreditService,
    private readonly payments: PaymentsService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.redis = new Redis(this.env.get('REDIS_URL'));
  }

  onModuleDestroy() {
    this.redis?.disconnect();
  }

  async getOverview(userId: string): Promise<DashboardOverviewResponse> {
    const cacheKey = `dashboard:${userId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return new DashboardOverviewResponse(JSON.parse(cached));

    const [
      creditBalance,
      { plan, subscription },
      resumeCount,
      workspaceTotal,
      workspaceCompleted,
      workspaceProcessing,
      workspaceFailed,
      recentWorkspaces,
      unreadNotifications,
    ] = await Promise.all([
      this.credits.balance(userId),
      this.payments.getSubscription(userId),
      this.resumes.count({ where: { userId } }),
      this.workspaces.count({ where: { userId } }),
      this.workspaces.count({ where: { userId, status: 'completed' } }),
      this.workspaces.count({ where: { userId, status: 'processing' } }),
      this.workspaces.count({ where: { userId, status: 'failed' } }),
      this.workspaces.find({
        where: { userId },
        order: { updatedAt: 'DESC' },
        take: 5,
        select: { id: true, name: true, status: true, updatedAt: true },
      }),
      this.notifications.unreadCount(userId),
    ]);

    const overview: DashboardOverviewResponse = new DashboardOverviewResponse({
      creditBalance,
      plan: {
        key: plan?.key ?? 'free',
        name: plan?.name ?? 'Free',
        status: subscription?.status ?? 'active',
        monthlyCredits: plan?.monthlyCredits ?? 0,
      },
      resumes: { count: resumeCount, limit: plan?.maxResumes ?? 3 },
      workspaces: {
        total: workspaceTotal,
        completed: workspaceCompleted,
        processing: workspaceProcessing,
        failed: workspaceFailed,
        recent: recentWorkspaces.map((w) => ({
          id: w.id,
          name: w.name,
          status: w.status,
          updatedAt: w.updatedAt,
        })),
      },
      unreadNotifications,
    });

    await this.redis.setex(cacheKey, CACHE_TTL_SEC, JSON.stringify(overview));
    return overview;
  }
}
