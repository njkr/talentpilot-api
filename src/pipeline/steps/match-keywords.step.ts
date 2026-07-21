import { Injectable } from '@nestjs/common';
import { PipelineStep, PipelineContext, StepResult } from './step.interface';
import { STEP_MANIFEST } from './step-manifest';
import { EmbeddingsService } from '../../embeddings/embeddings.service';
import { SemanticScorerService } from '../../ats/services/semantic-scorer.service';
import { KeywordMatcherService } from '../../ats/services/keyword-matcher.service';
import { MatchData } from '../../ats/ats.types';

const META = STEP_MANIFEST.match_keywords;

@Injectable()
export class MatchKeywordsStep extends PipelineStep {
  readonly name = 'match_keywords';
  readonly label = 'Matching your experience against the requirements';
  readonly dependsOn = META.dependsOn;
  readonly progressWeight = META.progressWeight;
  readonly creditWeight = META.creditWeight;

  constructor(
    private readonly embeddings: EmbeddingsService,
    private readonly scorer: SemanticScorerService,
    private readonly keywordMatcher: KeywordMatcherService,
  ) {
    super();
  }

  async run(ctx: PipelineContext): Promise<StepResult> {
    const matchData = await this.computeMatchData(ctx);
    ctx.artifacts.set(this.name, matchData);

    return {
      preview: {
        semanticScore: matchData.semantic.semanticScore,
        keywordsMatched: matchData.keywords.filter(
          (k) => k.status === 'matched',
        ).length,
        keywordsTotal: matchData.keywords.length,
      },
    };
  }

  /**
   * Exposed separately from run() because ctx.artifacts is in-memory only, scoped to
   * one StepRunner.execute() call. On a resumed run (worker crashed after this step
   * completed), this step's run() correctly does NOT re-execute — but that also means
   * it never repopulates ctx.artifacts for ScoreAtsStep to read. ScoreAtsStep falls
   * back to calling this directly rather than requiring an on-disk cache: embeddings
   * already exist by this point, so recomputing is one DB query plus (deterministic,
   * content-hash-stable) keyword matching — not a second AI resume/JD parse.
   */
  async computeMatchData(ctx: PipelineContext): Promise<MatchData> {
    const requirementMatches = await this.embeddings.matchRequirements(
      ctx.resume.id,
      ctx.resumeVersion,
      ctx.jd.id,
    );
    const semantic = this.scorer.score(requirementMatches);
    const keywords = await this.keywordMatcher.match(
      ctx.jd,
      ctx.sections,
      ctx.resume.rawText ?? '',
      ctx.userId,
    );
    return { semantic, keywords };
  }
}
