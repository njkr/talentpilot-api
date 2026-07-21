import { Injectable } from '@nestjs/common';
import { PipelineStep, PipelineContext, StepResult } from './step.interface';
import { STEP_MANIFEST } from './step-manifest';
import { AtsService } from '../../ats/ats.service';
import { MatchKeywordsStep } from './match-keywords.step';
import { MatchData } from '../../ats/ats.types';

const META = STEP_MANIFEST.score_ats;

@Injectable()
export class ScoreAtsStep extends PipelineStep {
  readonly name = 'score_ats';
  readonly label = 'Scoring against ATS criteria';
  readonly dependsOn = META.dependsOn;
  readonly progressWeight = META.progressWeight;
  readonly creditWeight = META.creditWeight;

  constructor(
    private readonly ats: AtsService,
    private readonly matchKeywordsStep: MatchKeywordsStep,
  ) {
    super();
  }

  async run(ctx: PipelineContext): Promise<StepResult> {
    const matchData =
      (ctx.artifacts.get('match_keywords') as MatchData | undefined) ??
      (await this.matchKeywordsStep.computeMatchData(ctx));

    const report = await this.ats.generate(ctx, matchData);
    return {
      outputRef: `ats_reports:${report.id}`,
      // Streamed to the client the instant it lands — the user sees their score
      // before the run finishes.
      preview: {
        overallScore: report.overallScore,
        keywordScore: report.keywordScore,
      },
    };
  }
}
