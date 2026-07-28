import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Redis } from 'ioredis';
import { Env } from '../config/config.module';
import { Resume } from '../resumes/entities/resume.entity';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { CreditService } from '../credits/credit.service';
import { PaymentsService } from '../payments/payments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentConfigService } from '../payments/config/payment-config.service';
import { DashboardOverviewResponse } from './dto/dashboard-overview.dto';

const CACHE_TTL_SEC = 30;

// How many of a user's profile fields count toward "profile completeness". Kept in one
// place since buildActionItems() and profileCompleteness() both need to agree on it.
const PROFILE_FIELDS_TRACKED = 12;

interface ScoreRow {
  score: number;
  date: string;
}
interface RecentWorkspaceRow {
  id: string;
  name: string;
  status: string;
  updatedAt: Date;
  score: number | null;
}
interface GapRow {
  keyword: string;
  missCount: number;
}
interface ActivityRow {
  date: string;
  runs: number;
}

/**
 * Everything a dashboard needs, in ONE round-trip from the client's perspective. All
 * sources below are fetched in parallel (Promise.all) rather than sequentially — none
 * depends on another's result — and the assembled result is cached in Redis briefly. A
 * dashboard is read constantly (every page load, every poll) but changes slowly;
 * without the cache, a page refresh storm turns into Nx the DB load per hit.
 *
 * Every addition here is a single cheap, indexed aggregate query — no per-row N+1, no
 * AI calls, no external fetches. If an insight can't be computed that way, it doesn't
 * belong here.
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
    private readonly paymentConfig: PaymentConfigService,
    private readonly dataSource: DataSource,
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
      config,
      scoreRows,
      creditFlows,
      topGaps,
      activity,
      pendingSuggestionWorkspaces,
      profileCompleteness,
    ] = await Promise.all([
      this.credits.balance(userId),
      this.payments.getSubscription(userId),
      this.resumes.count({ where: { userId } }),
      this.workspaces.count({ where: { userId } }),
      this.workspaces.count({ where: { userId, status: 'completed' } }),
      this.workspaces.count({ where: { userId, status: 'processing' } }),
      this.workspaces.count({ where: { userId, status: 'failed' } }),
      this.recentWorkspaces(userId),
      this.notifications.unreadCount(userId),
      this.paymentConfig.get(),
      this.scoreTrend(userId),
      this.creditFlows(userId),
      this.topGaps(userId),
      this.activity(userId),
      this.pendingSuggestionWorkspaceCount(userId),
      this.profileCompleteness(userId),
    ]);

    const analyzeCost = config.analyzeCost;
    const attention = {
      // Reuses the workspace COUNT already fetched above rather than re-deriving it from
      // pipeline_runs: a workspace's `status` is denormalized from its latest run (see
      // Workspace entity), so this is both cheaper and more correct than counting
      // historical failed runs — a workspace retried successfully shouldn't still read
      // as "needs attention" just because an old run once failed.
      failedRuns: workspaceFailed,
      workspacesWithPendingSuggestions: pendingSuggestionWorkspaces,
    };

    const overview: DashboardOverviewResponse = new DashboardOverviewResponse({
      creditBalance,
      plan: {
        key: plan?.key ?? 'free',
        name: plan?.name ?? 'Free',
        status: subscription?.status ?? 'active',
        monthlyCredits: plan?.monthlyCredits ?? 0,
      },
      resumes: { count: resumeCount, limit: plan?.limits?.maxResumes ?? 3 },
      workspaces: {
        total: workspaceTotal,
        completed: workspaceCompleted,
        processing: workspaceProcessing,
        failed: workspaceFailed,
        recent: recentWorkspaces,
      },
      unreadNotifications,

      scoreInsight: {
        latestScore: scoreRows[0]?.score ?? null,
        averageScore: scoreRows.length
          ? Math.round(
              scoreRows.reduce((s, r) => s + r.score, 0) / scoreRows.length,
            )
          : null,
        bestScore: scoreRows.length
          ? Math.max(...scoreRows.map((r) => r.score))
          : null,
        trend: scoreRows
          .slice(0, 10)
          .reverse()
          .map((r) => ({ date: r.date, score: r.score })),
      },

      creditInsight: {
        balance: creditBalance,
        spentLast30Days: creditFlows.spent,
        grantedLast30Days: creditFlows.granted,
        monthlyAllowance: plan?.monthlyCredits ?? 0,
        // analyzeCost is admin-editable down to 0 (free analyses) — guard the division
        // so a 0 cost can never turn this into Infinity (which JSON.stringify silently
        // turns into null).
        runsRemaining:
          analyzeCost > 0
            ? Math.floor(creditBalance / analyzeCost)
            : creditBalance,
      },

      topGaps,
      activity,
      attention,
      actionItems: this.buildActionItems({
        attention,
        credits: creditBalance,
        analyzeCost,
        profileCompleteness,
      }),
    });

    await this.redis.setex(cacheKey, CACHE_TTL_SEC, JSON.stringify(overview));
    return overview;
  }

  /**
   * The user's completed ATS scores, newest first. One indexed query over ats_reports
   * joined to the user's workspaces. Drives latest/average/best + the sparkline.
   */
  private async scoreTrend(userId: string): Promise<ScoreRow[]> {
    return this.dataSource.query(
      `
      SELECT r.overall_score AS score,
             to_char(r.created_at, 'YYYY-MM-DD') AS date
      FROM ats_reports r
      JOIN workspaces w ON w.id = r.workspace_id
      WHERE w.user_id = $1 AND w.deleted_at IS NULL
      ORDER BY r.created_at DESC
      LIMIT 20
      `,
      [userId],
    );
  }

  /**
   * Credits in and out over the last 30 days, from the ledger. Two SUMs, one query.
   * `spent` = abs of negatives, `granted` = positives — credits_ledger.amount is
   * signed (see CreditLedger entity). SUM() over an int column returns a Postgres
   * bigint, which node-postgres returns as a STRING to avoid precision loss — hence
   * the explicit Number() conversions.
   */
  private async creditFlows(
    userId: string,
  ): Promise<{ spent: number; granted: number }> {
    const [row] = await this.dataSource.query(
      `
      SELECT
        COALESCE(-SUM(amount) FILTER (WHERE amount < 0), 0) AS spent,
        COALESCE( SUM(amount) FILTER (WHERE amount > 0), 0) AS granted
      FROM credits_ledger
      WHERE user_id = $1 AND created_at > now() - interval '30 days'
      `,
      [userId],
    );
    return { spent: Number(row.spent), granted: Number(row.granted) };
  }

  /**
   * The keywords most often MISSING across the user's reports — their recurring weak
   * spots. `canonical` (when set) normalizes variants of the same skill (e.g. "K8s" and
   * "Kubernetes") so they aggregate together instead of splitting the count.
   */
  private async topGaps(userId: string): Promise<GapRow[]> {
    return this.dataSource.query(
      `
      SELECT COALESCE(km.canonical, km.keyword) AS keyword,
             COUNT(*)::int AS "missCount"
      FROM ats_reports r
      JOIN workspaces w ON w.id = r.workspace_id
      JOIN keyword_matches km ON km.ats_report_id = r.id
      WHERE w.user_id = $1 AND w.deleted_at IS NULL AND km.status = 'missing'
      GROUP BY COALESCE(km.canonical, km.keyword)
      ORDER BY "missCount" DESC
      LIMIT 5
      `,
      [userId],
    );
  }

  /** Runs per day for the last 14 days — a small activity bar/heatmap. */
  private async activity(userId: string): Promise<ActivityRow[]> {
    return this.dataSource.query(
      `
      SELECT to_char(day, 'YYYY-MM-DD') AS date, COALESCE(c.runs, 0)::int AS runs
      FROM generate_series(now()::date - interval '13 days', now()::date, '1 day') AS day
      LEFT JOIN (
        SELECT date_trunc('day', pr.created_at) AS d, COUNT(*) AS runs
        FROM pipeline_runs pr
        JOIN workspaces w ON w.id = pr.workspace_id
        WHERE w.user_id = $1 AND w.deleted_at IS NULL
          AND pr.created_at > now() - interval '14 days'
        GROUP BY 1
      ) c ON c.d = day
      ORDER BY day
      `,
      [userId],
    );
  }

  private async pendingSuggestionWorkspaceCount(
    userId: string,
  ): Promise<number> {
    const [row] = await this.dataSource.query(
      `
      SELECT COUNT(DISTINCT s.workspace_id)::int AS count
      FROM ai_suggestions s
      JOIN workspaces w ON w.id = s.workspace_id
      WHERE w.user_id = $1 AND w.deleted_at IS NULL AND s.status = 'pending'
      `,
      [userId],
    );
    return row.count;
  }

  /**
   * Recent workspaces, now with the latest ATS score joined in — much more useful on
   * the list than status alone. A LATERAL join keeps this a single query rather than
   * N+1 lookups per workspace.
   */
  private async recentWorkspaces(
    userId: string,
  ): Promise<RecentWorkspaceRow[]> {
    return this.dataSource.query(
      `
      SELECT w.id, w.name, w.status, w.updated_at AS "updatedAt", r.overall_score AS score
      FROM workspaces w
      LEFT JOIN LATERAL (
        SELECT overall_score FROM ats_reports ar
        WHERE ar.workspace_id = w.id ORDER BY ar.created_at DESC LIMIT 1
      ) r ON true
      WHERE w.user_id = $1 AND w.deleted_at IS NULL
      ORDER BY w.updated_at DESC
      LIMIT 5
      `,
      [userId],
    );
  }

  /**
   * No completeness column exists on Profile — computed here from how many of its
   * optional fields are filled in. Keep PROFILE_FIELDS_TRACKED in sync with the count
   * below if a field is added or removed.
   */
  private async profileCompleteness(userId: string): Promise<number> {
    const [row] = await this.dataSource.query(
      `
      SELECT ROUND(100.0 * (
        (first_name IS NOT NULL)::int + (last_name IS NOT NULL)::int +
        (phone IS NOT NULL)::int + (linkedin IS NOT NULL)::int +
        (github IS NOT NULL)::int + (portfolio IS NOT NULL)::int +
        (country IS NOT NULL)::int + (city IS NOT NULL)::int +
        (timezone IS NOT NULL)::int + (years_experience IS NOT NULL)::int +
        (target_role IS NOT NULL)::int + (salary_expectation IS NOT NULL)::int
      ) / ${PROFILE_FIELDS_TRACKED})::int AS completeness
      FROM profiles WHERE user_id = $1
      `,
      [userId],
    );
    return row?.completeness ?? 0;
  }

  /**
   * Turns raw state into a prioritized to-do list. This is what makes the dashboard
   * actionable rather than informational — each item is a specific next step with a
   * link.
   */
  private buildActionItems(ctx: {
    attention: { failedRuns: number; workspacesWithPendingSuggestions: number };
    credits: number;
    analyzeCost: number;
    profileCompleteness: number;
  }): DashboardOverviewResponse['actionItems'] {
    const items: DashboardOverviewResponse['actionItems'] = [];

    if (ctx.attention.failedRuns > 0) {
      items.push({
        kind: 'failed_run',
        priority: 'high',
        label: `${ctx.attention.failedRuns} analysis ${ctx.attention.failedRuns === 1 ? 'run' : 'runs'} failed — retry available`,
        href: '/workspaces?filter=failed',
      });
    }
    if (ctx.attention.workspacesWithPendingSuggestions > 0) {
      items.push({
        kind: 'pending_suggestions',
        priority: 'medium',
        label: `${ctx.attention.workspacesWithPendingSuggestions} ${ctx.attention.workspacesWithPendingSuggestions === 1 ? 'workspace has' : 'workspaces have'} suggestions to review`,
        href: '/workspaces',
      });
    }
    // analyzeCost === 0 means analyses are free right now — credits can never run out.
    if (ctx.analyzeCost > 0 && ctx.credits < ctx.analyzeCost) {
      items.push({
        kind: 'low_credits',
        priority: 'high',
        label: 'Low credits — top up to run another analysis',
        href: '/billing',
      });
    }
    if (ctx.profileCompleteness < 100) {
      items.push({
        kind: 'incomplete_profile',
        priority: 'low',
        label: `Complete your profile (${ctx.profileCompleteness}%) for better tailoring`,
        href: '/settings',
      });
    }

    const rank = { high: 0, medium: 1, low: 2 };
    return items.sort((a, b) => rank[a.priority] - rank[b.priority]);
  }
}
