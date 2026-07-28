import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TokenUsage } from '../ai/entities/token-usage.entity';
import { IntegrationCall } from '../integration-calls/entities/integration-call.entity';

const INTEGRATION_CALL_PROVIDERS = [
  'resend',
  'tavily',
  'stripe',
  's3',
] as const;
const PROVIDERS = ['openai', ...INTEGRATION_CALL_PROVIDERS] as const;
export type IntegrationProviderName = (typeof PROVIDERS)[number];

export interface ProviderOverview {
  provider: IntegrationProviderName;
  calls: number;
  errors: number;
  costUsd?: string;
}

export interface ProviderDailyRow {
  day: Date;
  calls: number;
  errors: number;
  costUsd?: string;
}

@Injectable()
export class AdminIntegrationsService {
  constructor(
    @InjectRepository(TokenUsage)
    private readonly tokenUsage: Repository<TokenUsage>,
    @InjectRepository(IntegrationCall)
    private readonly integrationCalls: Repository<IntegrationCall>,
  ) {}

  static readonly PROVIDERS = PROVIDERS;

  // ── Overview: last 24h across all providers ─────────────────────────────
  async overview(): Promise<{ since: Date; providers: ProviderOverview[] }> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [openaiRow, callRows] = await Promise.all([
      this.tokenUsage
        .createQueryBuilder('u')
        .select('COUNT(*)', 'calls')
        .addSelect('COUNT(*) FILTER (WHERE u.success = false)', 'errors')
        .addSelect('COALESCE(SUM(u.costUsd), 0)', 'costUsd')
        .where('u.createdAt >= :since', { since })
        .getRawOne<{ calls: string; errors: string; costUsd: string }>(),
      this.integrationCalls
        .createQueryBuilder('c')
        .select('c.provider', 'provider')
        .addSelect('COUNT(*)', 'calls')
        .addSelect('COUNT(*) FILTER (WHERE c.success = false)', 'errors')
        .where('c.createdAt >= :since', { since })
        .groupBy('c.provider')
        .getRawMany<{ provider: string; calls: string; errors: string }>(),
    ]);

    const callsByProvider = new Map(callRows.map((r) => [r.provider, r]));

    const providers: ProviderOverview[] = PROVIDERS.map((provider) => {
      if (provider === 'openai') {
        return {
          provider,
          calls: Number(openaiRow?.calls ?? 0),
          errors: Number(openaiRow?.errors ?? 0),
          costUsd: openaiRow?.costUsd ?? '0',
        };
      }
      const row = callsByProvider.get(provider);
      return {
        provider,
        calls: Number(row?.calls ?? 0),
        errors: Number(row?.errors ?? 0),
      };
    });

    return { since, providers };
  }

  // ── Per-provider daily history ───────────────────────────────────────────
  async dailyHistory(
    provider: IntegrationProviderName,
    days = 30,
  ): Promise<{
    provider: IntegrationProviderName;
    since: Date;
    days: ProviderDailyRow[];
  }> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    if (provider === 'openai') {
      const rows = await this.tokenUsage
        .createQueryBuilder('u')
        .select("DATE_TRUNC('day', u.createdAt)", 'day')
        .addSelect('COUNT(*)', 'calls')
        .addSelect('COUNT(*) FILTER (WHERE u.success = false)', 'errors')
        .addSelect('COALESCE(SUM(u.costUsd), 0)', 'costUsd')
        .where('u.createdAt >= :since', { since })
        .groupBy("DATE_TRUNC('day', u.createdAt)")
        .orderBy('day', 'ASC')
        .getRawMany();
      return { provider, since, days: rows };
    }

    const rows = await this.integrationCalls
      .createQueryBuilder('c')
      .select("DATE_TRUNC('day', c.createdAt)", 'day')
      .addSelect('COUNT(*)', 'calls')
      .addSelect('COUNT(*) FILTER (WHERE c.success = false)', 'errors')
      .where('c.provider = :provider AND c.createdAt >= :since', {
        provider,
        since,
      })
      .groupBy("DATE_TRUNC('day', c.createdAt)")
      .orderBy('day', 'ASC')
      .getRawMany();
    return { provider, since, days: rows };
  }
}
