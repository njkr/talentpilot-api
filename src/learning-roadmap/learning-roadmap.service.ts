import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AiService } from '../ai/ai.service';
import { LearningRoadmapOutput } from '../ai/schemas/learning-roadmap.schema';
import { LearningRoadmap } from './entities/learning-roadmap.entity';
import { AtsReport } from '../ats/entities/ats-report.entity';
import { AtsKeywordMatch } from '../ats/entities/ats-keyword-match.entity';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { PipelineContext } from '../pipeline/steps/step.interface';
import { renderJdSummary } from '../job-descriptions/utils/render-jd.util';

@Injectable()
export class LearningRoadmapService {
  constructor(
    private readonly ai: AiService,
    @InjectRepository(LearningRoadmap)
    private readonly roadmaps: Repository<LearningRoadmap>,
    @InjectRepository(AtsReport)
    private readonly reports: Repository<AtsReport>,
    @InjectRepository(AtsKeywordMatch)
    private readonly matches: Repository<AtsKeywordMatch>,
    @InjectRepository(Workspace)
    private readonly workspaces: Repository<Workspace>,
  ) {}

  async generate(ctx: PipelineContext): Promise<LearningRoadmap> {
    const report = await this.reports.findOne({ where: { runId: ctx.runId } });
    if (!report) {
      throw new NotFoundException(`No ATS report found for run ${ctx.runId}`);
    }
    const gaps = await this.matches.find({
      where: { atsReportId: report.id, status: In(['missing', 'partial']) },
    });

    const { data: out } = await this.ai.complete<LearningRoadmapOutput>({
      feature: 'learning_roadmap',
      promptKey: 'learning_roadmap',
      variables: {
        jd_summary: renderJdSummary(ctx.jd),
        gap_list:
          gaps
            .map((g) => `- ${g.keyword} (${g.importance}, ${g.status})`)
            .join('\n') || 'No significant gaps identified.',
        ats_weaknesses: report.weaknesses.join('\n') || 'None noted.',
      },
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      runId: ctx.runId,
      stepName: 'build_learning_path',
    });

    // Cap enforced in code too — a stray model output over the limit must not silently
    // ship a 20-item "homework list" (see the schema's own .max(6), belt and braces).
    const items = out.items.slice(0, 6);

    return this.roadmaps.save(
      this.roadmaps.create({
        workspaceId: ctx.workspaceId,
        runId: ctx.runId,
        items,
      }),
    );
  }

  async getForWorkspace(
    workspaceId: string,
    userId: string,
  ): Promise<LearningRoadmap> {
    const ws = await this.workspaces.findOne({
      where: { id: workspaceId, userId },
    });
    if (!ws) throw new NotFoundException();
    const roadmap = await this.roadmaps.findOne({ where: { workspaceId } });
    if (!roadmap) throw new NotFoundException();
    return roadmap;
  }
}
