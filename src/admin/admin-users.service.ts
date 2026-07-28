import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { Resume } from '../resumes/entities/resume.entity';
import { CoverLetter } from '../cover-letter/entities/cover-letter.entity';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { Referral } from '../referrals/entities/referral.entity';
import { Subscription } from '../payments/entities/subscription.entity';
import { Plan } from '../payments/entities/plan.entity';
import { TokenUsage } from '../ai/entities/token-usage.entity';
import { decodeCursor, encodeCursor } from '../common/utils/cursor.util';
import { Problems } from '../common/problems';
import { AdminUserQueryDto } from './dto/admin-user-query.dto';

export interface AdminUserRow {
  id: string;
  email: string;
  role: 'user' | 'admin';
  status: 'active' | 'suspended' | 'deleted';
  isVerified: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
  planKey: string;
  planName: string;
  totalSpendUsd: string;
  spendLastNDaysUsd: string;
  resumeCount: number;
  coverLetterCount: number;
  referrals: { invited: number; qualified: number };
}

export interface AdminUserListResult {
  data: AdminUserRow[];
  hasMore: boolean;
  nextCursor: string | null;
  since: Date;
}

@Injectable()
export class AdminUsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Resume) private readonly resumes: Repository<Resume>,
    @InjectRepository(CoverLetter)
    private readonly coverLetters: Repository<CoverLetter>,
    @InjectRepository(Referral)
    private readonly referrals: Repository<Referral>,
    @InjectRepository(Subscription)
    private readonly subscriptions: Repository<Subscription>,
    @InjectRepository(Plan) private readonly plans: Repository<Plan>,
    @InjectRepository(TokenUsage)
    private readonly tokenUsage: Repository<TokenUsage>,
  ) {}

  async list(q: AdminUserQueryDto): Promise<AdminUserListResult> {
    const since = new Date(Date.now() - q.days * 24 * 60 * 60 * 1000);
    const after = decodeCursor(q.cursor);

    const qb = this.users
      .createQueryBuilder('u')
      .orderBy('u.created_at', 'DESC')
      .addOrderBy('u.id', 'DESC')
      .take(q.limit + 1);

    if (q.search)
      qb.andWhere('u.email ILIKE :search', { search: `%${q.search}%` });
    if (q.status) qb.andWhere('u.status = :status', { status: q.status });
    if (after) {
      qb.andWhere('(u.created_at, u.id) < (:c, :i)', {
        c: after.createdAt,
        i: after.id,
      });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    const ids = page.map((u) => u.id);

    if (ids.length === 0) {
      return { data: [], hasMore: false, nextCursor: null, since };
    }

    const [
      subs,
      allPlans,
      totalSpendRows,
      recentSpendRows,
      resumeRows,
      coverLetterRows,
      referralRows,
    ] = await Promise.all([
      this.subscriptions.find({ where: { userId: In(ids) } }),
      this.plans.find(),
      this.tokenUsage
        .createQueryBuilder('t')
        .select('t.userId', 'userId')
        .addSelect('COALESCE(SUM(t.costUsd), 0)', 'costUsd')
        .where('t.userId IN (:...ids)', { ids })
        .groupBy('t.userId')
        .getRawMany<{ userId: string; costUsd: string }>(),
      this.tokenUsage
        .createQueryBuilder('t')
        .select('t.userId', 'userId')
        .addSelect('COALESCE(SUM(t.costUsd), 0)', 'costUsd')
        .where('t.userId IN (:...ids) AND t.createdAt >= :since', {
          ids,
          since,
        })
        .groupBy('t.userId')
        .getRawMany<{ userId: string; costUsd: string }>(),
      this.resumes
        .createQueryBuilder('r')
        .select('r.userId', 'userId')
        .addSelect('COUNT(*)', 'count')
        .where('r.userId IN (:...ids)', { ids })
        .andWhere('r.deletedAt IS NULL')
        .groupBy('r.userId')
        .getRawMany<{ userId: string; count: string }>(),
      this.coverLetters
        .createQueryBuilder('cl')
        .innerJoin(Workspace, 'w', 'w.id = cl.workspaceId')
        .select('w.userId', 'userId')
        .addSelect('COUNT(*)', 'count')
        .where('w.userId IN (:...ids)', { ids })
        .groupBy('w.userId')
        .getRawMany<{ userId: string; count: string }>(),
      this.referrals
        .createQueryBuilder('r')
        .select('r.referrerId', 'userId')
        .addSelect('COUNT(*)', 'invited')
        .addSelect(
          'COUNT(*) FILTER (WHERE r.rewardGranted = true)',
          'qualified',
        )
        .where('r.referrerId IN (:...ids)', { ids })
        .groupBy('r.referrerId')
        .getRawMany<{ userId: string; invited: string; qualified: string }>(),
    ]);

    const subByUser = new Map(subs.map((s) => [s.userId, s]));
    const planNameByKey = new Map(allPlans.map((p) => [p.key, p.name]));
    const totalSpendByUser = new Map(
      totalSpendRows.map((r) => [r.userId, r.costUsd]),
    );
    const recentSpendByUser = new Map(
      recentSpendRows.map((r) => [r.userId, r.costUsd]),
    );
    const resumeCountByUser = new Map(
      resumeRows.map((r) => [r.userId, Number(r.count)]),
    );
    const coverLetterCountByUser = new Map(
      coverLetterRows.map((r) => [r.userId, Number(r.count)]),
    );
    const referralsByUser = new Map(
      referralRows.map((r) => [
        r.userId,
        { invited: Number(r.invited), qualified: Number(r.qualified) },
      ]),
    );

    const data: AdminUserRow[] = page.map((u) => {
      const planKey = subByUser.get(u.id)?.planKey ?? 'free';
      return {
        id: u.id,
        email: u.email,
        role: u.role,
        status: u.status,
        isVerified: u.isVerified,
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt,
        planKey,
        planName: planNameByKey.get(planKey) ?? planKey,
        totalSpendUsd: totalSpendByUser.get(u.id) ?? '0',
        spendLastNDaysUsd: recentSpendByUser.get(u.id) ?? '0',
        resumeCount: resumeCountByUser.get(u.id) ?? 0,
        coverLetterCount: coverLetterCountByUser.get(u.id) ?? 0,
        referrals: referralsByUser.get(u.id) ?? { invited: 0, qualified: 0 },
      };
    });

    return {
      data,
      hasMore,
      nextCursor: hasMore ? encodeCursor(page.at(-1)!) : null,
      since,
    };
  }

  async suspend(
    targetId: string,
    actingAdminId: string,
  ): Promise<{ previousStatus: string }> {
    if (targetId === actingAdminId) throw Problems.cannotModifyOwnAccess();
    const user = await this.users.findOne({ where: { id: targetId } });
    if (!user) throw new NotFoundException('User not found.');
    const previousStatus = user.status;
    user.status = 'suspended';
    await this.users.save(user);
    return { previousStatus };
  }

  async activate(targetId: string): Promise<{ previousStatus: string }> {
    const user = await this.users.findOne({ where: { id: targetId } });
    if (!user) throw new NotFoundException('User not found.');
    const previousStatus = user.status;
    user.status = 'active';
    await this.users.save(user);
    return { previousStatus };
  }
}
