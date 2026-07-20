import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TokenUsage } from '../entities/token-usage.entity';
import { Env } from '../../config/config.module';
import { Problems } from '../../common/problems';

/**
 * Owns the token_usage table: it's both the budget guard (reads today's spend before a
 * call is allowed) and the metering log (writes one row per call, success or failure).
 * Keeping both in one place means the numbers the guard checks against are exactly the
 * numbers that get reported later — no second bookkeeping path to drift out of sync.
 */
@Injectable()
export class BudgetService {
  constructor(
    @InjectRepository(TokenUsage) private readonly repo: Repository<TokenUsage>,
    private readonly env: Env,
  ) {}

  private startOfUtcDay(): Date {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }

  private async spentSince(start: Date, userId?: string): Promise<number> {
    const qb = this.repo
      .createQueryBuilder('t')
      .select('COALESCE(SUM(t.costUsd), 0)', 'total')
      .where('t.createdAt >= :start', { start });
    if (userId) qb.andWhere('t.userId = :userId', { userId });
    const row = await qb.getRawOne<{ total: string }>();
    return Number(row?.total ?? 0);
  }

  /** Throws if AI is killed or either budget is already exhausted. Check BEFORE calling the model. */
  async assertWithinBudget(userId: string | null): Promise<void> {
    if (this.env.get('AI_KILL_SWITCH')) {
      throw Problems.aiProviderUnavailable();
    }

    const start = this.startOfUtcDay();
    const globalSpent = await this.spentSince(start);
    if (globalSpent >= this.env.get('AI_GLOBAL_DAILY_BUDGET_USD')) {
      throw Problems.aiBudgetExceeded('global');
    }

    if (userId) {
      const userSpent = await this.spentSince(start, userId);
      if (userSpent >= this.env.get('AI_USER_DAILY_BUDGET_USD')) {
        throw Problems.aiBudgetExceeded('user');
      }
    }
  }

  /** Logs one row per attempt, win or lose — failed/retried calls still cost tokens. */
  recordUsage(usage: {
    userId?: string | null;
    workspaceId?: string | null;
    runId?: string | null;
    stepName?: string | null;
    feature: string;
    model: string;
    promptKey?: string | null;
    promptVersion?: number | null;
    promptTokens: number;
    completionTokens: number;
    cachedTokens?: number;
    costUsd: string;
    durationMs: number;
    attempts?: number;
    success: boolean;
    errorType?: string | null;
  }): Promise<TokenUsage> {
    const row = this.repo.create({
      userId: usage.userId ?? null,
      workspaceId: usage.workspaceId ?? null,
      runId: usage.runId ?? null,
      stepName: usage.stepName ?? null,
      feature: usage.feature,
      model: usage.model,
      promptKey: usage.promptKey ?? null,
      promptVersion: usage.promptVersion ?? null,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      cachedTokens: usage.cachedTokens ?? 0,
      costUsd: usage.costUsd,
      durationMs: usage.durationMs,
      attempts: usage.attempts ?? 1,
      success: usage.success,
      errorType: usage.errorType ?? null,
    });
    return this.repo.save(row);
  }
}
