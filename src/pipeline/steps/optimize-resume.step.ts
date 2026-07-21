import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PipelineStep, PipelineContext, StepResult } from './step.interface';
import { STEP_MANIFEST } from './step-manifest';
import { SuggestionsService } from '../../suggestions/suggestions.service';
import { AtsReport } from '../../ats/entities/ats-report.entity';

const META = STEP_MANIFEST.optimize_resume;

@Injectable()
export class OptimizeResumeStep extends PipelineStep {
  readonly name = 'optimize_resume';
  readonly label = 'Writing improvement suggestions';
  readonly dependsOn = META.dependsOn;
  readonly progressWeight = META.progressWeight;
  readonly creditWeight = META.creditWeight;

  constructor(
    private readonly suggestions: SuggestionsService,
    @InjectRepository(AtsReport)
    private readonly reports: Repository<AtsReport>,
  ) {
    super();
  }

  async run(ctx: PipelineContext): Promise<StepResult> {
    const report = await this.reports.findOne({ where: { runId: ctx.runId } });
    if (!report) {
      // score_ats is a hard dependency — this only happens if something upstream
      // skipped saving its report, which is itself a bug worth surfacing loudly.
      throw new NotFoundException(`No ATS report found for run ${ctx.runId}`);
    }

    const saved = await this.suggestions.generate(ctx, report);
    return {
      outputRef: `ai_suggestions:${ctx.workspaceId}`,
      preview: { count: saved.length },
    };
  }
}
