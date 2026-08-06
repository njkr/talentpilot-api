import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentConfig } from '../entities/payment-config.entity';
import { AuditService } from '../../audit/audit.service';

const SINGLETON_ID = 1;
const CACHE_TTL_MS = 60_000;

@Injectable()
export class PaymentConfigService implements OnModuleInit {
  private cache: PaymentConfig | null = null;
  private cacheExpiry = 0;

  constructor(
    @InjectRepository(PaymentConfig)
    private readonly repo: Repository<PaymentConfig>,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit() {
    // Ensure the singleton exists on boot — every environment (including a fresh test
    // DB) must have exactly one row, so `get()` can safely use findOneOrFail.
    const existing = await this.repo.findOne({ where: { id: SINGLETON_ID } });
    if (!existing) {
      await this.repo.save(this.repo.create({ id: SINGLETON_ID }));
    }
  }

  /**
   * Cached read — this is called on EVERY credit debit (analyze, cover letter
   * regenerate, interview feedback), so it must not hit the DB each time. 60s cache:
   * an admin price/cost change takes at most a minute to propagate, which is fine,
   * and the credit path stays fast.
   */
  async get(): Promise<PaymentConfig> {
    if (this.cache && Date.now() < this.cacheExpiry) return this.cache;
    this.cache = await this.repo.findOneOrFail({
      where: { id: SINGLETON_ID },
    });
    this.cacheExpiry = Date.now() + CACHE_TTL_MS;
    return this.cache;
  }

  /** Every field an admin is allowed to change — deliberately excludes id/updatedAt/updatedBy. */
  private static readonly EDITABLE_FIELDS = [
    'signupCreditGrant',
    'referrerReward',
    'refereeReward',
    'referralQualifyingEvent',
    'maxReferralRewardsPerUser',
    'analyzeCost',
    'coverLetterRegenCost',
    'interviewFeedbackCost',
    'rescoreCost',
    'referralsEnabled',
    'creditPacksEnabled',
  ] as const;

  async update(
    patch: Partial<PaymentConfig>,
    adminId: string,
  ): Promise<PaymentConfig> {
    // Whitelist by construction, not by exclusion — never let id/updatedAt/updatedBy
    // through even if a caller's DTO validation is ever loosened.
    const safe: Partial<PaymentConfig> = {};
    for (const field of PaymentConfigService.EDITABLE_FIELDS) {
      if (patch[field] !== undefined) (safe as any)[field] = patch[field];
    }
    await this.repo.update(SINGLETON_ID, { ...safe, updatedBy: adminId });
    this.cache = null; // bust immediately for the editing admin (and everyone else within the TTL)
    await this.audit.log({
      userId: adminId,
      actorType: 'admin',
      action: 'payment_config.updated',
      resourceType: 'payment_config',
      resourceId: String(SINGLETON_ID),
      metadata: safe,
    });
    return this.get();
  }
}
