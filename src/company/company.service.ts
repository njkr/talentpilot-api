import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { createHash } from 'crypto';
import { AiService } from '../ai/ai.service';
import { CompanySynthesis } from '../ai/schemas/company-synthesis.schema';
import { CompanyResearchCache } from './entities/company-research-cache.entity';
import { CompanyInsight } from './entities/company-insight.entity';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { PipelineContext } from '../pipeline/steps/step.interface';
import { TavilyService } from './services/tavily.service';

const CACHE_TTL_MS = 7 * 86_400_000; // 7 days

@Injectable()
export class CompanyService {
  constructor(
    private readonly ai: AiService,
    private readonly tavily: TavilyService,
    @InjectRepository(CompanyResearchCache)
    private readonly cache: Repository<CompanyResearchCache>,
    @InjectRepository(CompanyInsight)
    private readonly insights: Repository<CompanyInsight>,
    @InjectRepository(Workspace)
    private readonly workspaces: Repository<Workspace>,
  ) {}

  async research(ctx: PipelineContext): Promise<CompanyInsight> {
    const company = ctx.jd.company;
    if (!company) {
      // No company name in the JD — nothing to research. Skip cleanly rather than
      // researching "Untitled position"; the step is optional so this just yields a
      // partial run, not a failed one.
      throw new Error('No company name in job description');
    }

    const hash = this.normaliseCompany(company);

    // ── Global 7-day cache ──
    // Company facts aren't user data — they're public information about a third
    // party. Caching globally means the 50th person applying to Stripe this week
    // pays nothing, and everyone gets the same (fresher, better-researched) answer.
    const cached = await this.cache.findOne({
      where: { companyHash: hash, expiresAt: MoreThan(new Date()) },
    });
    if (cached) {
      return this.copyToWorkspace(ctx, cached.payload, company, true);
    }

    const results = await this.tavily.research(company);

    const { data: out } = await this.ai.complete<CompanySynthesis>({
      feature: 'company_research',
      promptKey: 'company_synthesis',
      variables: {
        company,
        search_results:
          results
            .map(
              (r, i) =>
                `[${i + 1}] ${r.title}\n${r.url}\n${r.content.slice(0, 800)}`,
            )
            .join('\n\n') || 'No search results found.',
      },
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      runId: ctx.runId,
      stepName: 'research_company',
    });

    // upsert, not save(create()): the lookup above only matches an UNEXPIRED row, so a
    // stale row for this same company can still be sitting in the table — a plain
    // insert would collide with its still-unique companyHash. Refreshing it in place is
    // exactly what should happen to an expired cache entry anyway.
    await this.cache.upsert(
      {
        companyHash: hash,
        companyName: company,
        payload: out,
        expiresAt: new Date(Date.now() + CACHE_TTL_MS),
      },
      { conflictPaths: ['companyHash'] },
    );
    return this.copyToWorkspace(ctx, out, company, false);
  }

  async getForWorkspace(
    workspaceId: string,
    userId: string,
  ): Promise<CompanyInsight> {
    const ws = await this.workspaces.findOne({
      where: { id: workspaceId, userId },
    });
    if (!ws) throw new NotFoundException();
    const insight = await this.insights.findOne({ where: { workspaceId } });
    if (!insight) throw new NotFoundException();
    return insight;
  }

  private async copyToWorkspace(
    ctx: PipelineContext,
    payload: CompanySynthesis,
    companyName: string,
    fromCache: boolean,
  ): Promise<CompanyInsight> {
    return this.insights.save(
      this.insights.create({
        workspaceId: ctx.workspaceId,
        runId: ctx.runId,
        companyName,
        overview: payload.overview,
        culture: payload.culture,
        talkingPoints: payload.talkingPoints,
        sources: payload.sources,
        confidence: payload.confidence,
        fromCache,
      }),
    );
  }

  /** "Stripe, Inc." / "STRIPE" / "Stripe Inc" → the same cache key. */
  private normaliseCompany(name: string): string {
    const clean = name
      .toLowerCase()
      .replace(/\b(inc|llc|ltd|limited|corp|corporation|gmbh|plc|co)\b\.?/g, '')
      .replace(/[^a-z0-9]/g, '');
    return createHash('sha256').update(clean).digest('hex');
  }
}
