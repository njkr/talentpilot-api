import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Referral } from './entities/referral.entity';
import { User } from '../auth/entities/user.entity';
import { PaymentConfigService } from '../payments/config/payment-config.service';
import { CreditService } from '../credits/credit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CursorQueryDto } from '../common/dto/cursor-query.dto';
import { decodeCursor, encodeCursor } from '../common/utils/cursor.util';
import { generateReferralCode } from './utils/referral-code.util';

function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === '23505'
  );
}

@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name);

  constructor(
    @InjectRepository(Referral)
    private readonly referrals: Repository<Referral>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly config: PaymentConfigService,
    private readonly credits: CreditService,
    private readonly notifications: NotificationsService,
    private readonly dataSource: DataSource,
  ) {}

  /** Every user gets a stable code, generated lazily on first request. */
  async getMyCode(userId: string): Promise<string> {
    const user = await this.users.findOneOrFail({ where: { id: userId } });
    if (user.referralCode) return user.referralCode;

    // Short, unambiguous code (no 0/O/1/I). Retry on the rare unique-constraint collision.
    for (let i = 0; i < 5; i++) {
      const code = generateReferralCode();
      try {
        await this.users.update(userId, { referralCode: code });
        return code;
      } catch (e) {
        if (!isDuplicateKeyError(e)) throw e;
      }
    }
    throw new Error('could not allocate a unique referral code');
  }

  async statsFor(
    userId: string,
  ): Promise<{ invited: number; qualified: number; creditsEarned: number }> {
    const config = await this.config.get();
    const [invited, qualified] = await Promise.all([
      this.referrals.count({ where: { referrerId: userId } }),
      this.referrals.count({
        where: { referrerId: userId, rewardGranted: true },
      }),
    ]);
    return {
      invited,
      qualified,
      creditsEarned: qualified * config.referrerReward,
    };
  }

  /**
   * Called during registration when a referral code is present. Records the link but
   * grants NOTHING yet — rewards are deferred until the qualifying event (§config),
   * which is the whole anti-abuse design (see checkQualification()).
   */
  async recordSignup(
    refereeId: string,
    refereeEmail: string,
    code: string,
  ): Promise<void> {
    const config = await this.config.get();
    if (!config.referralsEnabled) return;

    const referrer = await this.users.findOne({
      where: { referralCode: code },
    });
    if (!referrer) return; // invalid code — ignore silently, don't fail registration

    // ── Guard 1: no self-referral ──
    if (referrer.id === refereeId) return;

    // ── Guard 2: one referral per referee, ever ──
    // Blocks "sign up 10 times with my own code" — also enforced at the DB level by
    // Referral.refereeId's unique constraint, so a race between two concurrent
    // registrations can't both succeed either.
    try {
      await this.users.update(refereeId, { referredBy: referrer.id });
      await this.referrals.save(
        this.referrals.create({
          referrerId: referrer.id,
          refereeId,
          refereeEmail,
          status: 'signed_up',
        }),
      );
    } catch (e) {
      if (!isDuplicateKeyError(e)) throw e;
      this.logger.warn(
        `referee ${refereeId} already has a referral row — ignoring`,
      );
    }
  }

  /**
   * Called when the referee hits the qualifying event (first_analysis by default).
   * THIS is where credits are granted — deferring to a real action, not signup, is
   * what stops throwaway-email farming: a fake signup that never analyzes never pays
   * out.
   */
  async checkQualification(refereeId: string, event: string): Promise<void> {
    const config = await this.config.get();
    if (!config.referralsEnabled || event !== config.referralQualifyingEvent) {
      return;
    }

    const referral = await this.referrals.findOne({
      where: { refereeId, status: 'signed_up', rewardGranted: false },
    });
    if (!referral) return;

    // ── Guard 3: per-referrer cap ──
    // Cap how many rewards one user can earn, so a leaked code can't drain the
    // credit budget.
    const rewardedCount = await this.referrals.count({
      where: { referrerId: referral.referrerId, rewardGranted: true },
    });
    if (rewardedCount >= config.maxReferralRewardsPerUser) {
      await this.referrals.update(referral.id, { status: 'qualified' }); // qualified but capped
      return;
    }

    // Grant BOTH sides atomically. The referral row's own rewardGranted flag (checked
    // above, set below, all inside one transaction) is what prevents a double-grant on
    // a retry — there's no separate ledger-based idempotency check needed here.
    await this.dataSource.transaction(async (manager) => {
      await this.credits.grant(
        referral.referrerId,
        config.referrerReward,
        'referral_reward',
        referral.id,
        manager,
        'referral',
      );
      await this.credits.grant(
        refereeId,
        config.refereeReward,
        'referral_bonus',
        referral.id,
        manager,
        'referral',
      );
      await manager.update(Referral, referral.id, {
        status: 'rewarded',
        rewardGranted: true,
        qualifiedAt: new Date(),
      });
    });

    await this.notifications.create(referral.referrerId, {
      type: 'referral_reward',
      title: 'You earned credits!',
      message: `Someone you invited just got started. ${config.referrerReward} credits added.`,
    });
  }

  async adminList(q: CursorQueryDto) {
    const after = decodeCursor(q.cursor);
    const qb = this.referrals
      .createQueryBuilder('r')
      .orderBy('r.created_at', 'DESC')
      .addOrderBy('r.id', 'DESC')
      .take(q.limit + 1);
    if (after) {
      qb.andWhere('(r.created_at, r.id) < (:c, :i)', {
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

  async globalStats(): Promise<{
    totalInvited: number;
    totalQualified: number;
    totalCreditsPaid: number;
  }> {
    const config = await this.config.get();
    const [totalInvited, totalQualified] = await Promise.all([
      this.referrals.count(),
      this.referrals.count({ where: { rewardGranted: true } }),
    ]);
    return {
      totalInvited,
      totalQualified,
      totalCreditsPaid:
        totalQualified * (config.referrerReward + config.refereeReward),
    };
  }
}
