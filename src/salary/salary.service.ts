import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiService } from '../ai/ai.service';
import { SalaryEstimateOutput } from '../ai/schemas/salary-estimate.schema';
import { SalaryEstimate } from './entities/salary-estimate.entity';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { PipelineContext } from '../pipeline/steps/step.interface';
import { TavilyService } from '../company/services/tavily.service';

@Injectable()
export class SalaryService {
  constructor(
    private readonly ai: AiService,
    private readonly tavily: TavilyService,
    @InjectRepository(SalaryEstimate)
    private readonly estimates: Repository<SalaryEstimate>,
    @InjectRepository(Workspace)
    private readonly workspaces: Repository<Workspace>,
  ) {}

  async generate(ctx: PipelineContext): Promise<SalaryEstimate> {
    const position = ctx.jd.parsedData?.position ?? ctx.jd.position;
    const seniority = ctx.jd.parsedData?.seniority ?? 'unspecified';
    const location = ctx.jd.location ?? 'unspecified location';

    const results = await this.tavily.searchMultiple([
      `${position} salary ${location} ${seniority}`,
      `${position} compensation range ${location}`,
    ]);

    const { data: out } = await this.ai.complete<SalaryEstimateOutput>({
      feature: 'salary_estimate',
      promptKey: 'salary_estimate',
      variables: {
        position,
        seniority,
        location,
        search_results:
          results
            .map(
              (r, i) =>
                `[${i + 1}] ${r.title}\n${r.url}\n${r.content.slice(0, 600)}`,
            )
            .join('\n\n') || 'No search results found.',
      },
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      runId: ctx.runId,
      stepName: 'estimate_salary',
    });

    return this.estimates.save(
      this.estimates.create({
        workspaceId: ctx.workspaceId,
        runId: ctx.runId,
        currency: out.currency,
        p25: out.p25,
        p50: out.p50,
        p75: out.p75,
        isEstimate: true,
        methodology: out.methodology,
        factors: out.factors,
        negotiationTips: out.negotiationTips,
      }),
    );
  }

  async getForWorkspace(
    workspaceId: string,
    userId: string,
  ): Promise<SalaryEstimate> {
    const ws = await this.workspaces.findOne({
      where: { id: workspaceId, userId },
    });
    if (!ws) throw new NotFoundException();
    const estimate = await this.estimates.findOne({ where: { workspaceId } });
    if (!estimate) throw new NotFoundException();
    return estimate;
  }
}
