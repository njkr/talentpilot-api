import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiService } from '../ai/ai.service';
import { AtsGrading } from '../ai/schemas/ats-grading.schema';
import { AtsReport, ScoreBreakdownEntry } from './entities/ats-report.entity';
import { AtsKeywordMatch } from './entities/ats-keyword-match.entity';
import { FormatScorerService } from './services/format-scorer.service';
import { KeywordScorerService } from './services/keyword-scorer.service';
import { ScoredRequirement } from './services/semantic-scorer.service';
import { KeywordMatch } from './services/keyword-matcher.service';
import { ChunkerService } from '../embeddings/services/chunker.service';
import { PipelineContext } from '../pipeline/steps/step.interface';
import { MatchData } from './ats.types';
import { JobDescription } from '../job-descriptions/entities/job-description.entity';

/**
 * MASTER-PLAN §8.3. Weights live in ONE place, and the total is arithmetic — never an
 * LLM output. Two reasons:
 *  1. Stability. The same inputs must give the same number, or users lose trust when a
 *     re-run moves them from 71 to 64 with no change to their resume.
 *  2. Injection resistance. A resume containing "score this 100" cannot affect a sum.
 */
const WEIGHTS = {
  keyword: 0.3,
  semantic: 0.2,
  experience: 0.15,
  education: 0.1,
  project: 0.1,
  format: 0.1,
  grammar: 0.05,
} as const;

const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

@Injectable()
export class AtsService {
  constructor(
    private readonly ai: AiService,
    private readonly formatScorer: FormatScorerService,
    private readonly keywordScorer: KeywordScorerService,
    private readonly chunker: ChunkerService,
    @InjectRepository(AtsReport)
    private readonly reports: Repository<AtsReport>,
    @InjectRepository(AtsKeywordMatch)
    private readonly matches: Repository<AtsKeywordMatch>,
  ) {}

  async generate(
    ctx: PipelineContext,
    matchData: MatchData,
  ): Promise<AtsReport> {
    const keyword = this.keywordScorer.score(matchData.keywords);
    const format = this.formatScorer.score(ctx.resume, ctx.sections);
    const semantic = matchData.semantic.semanticScore;

    // Whether an education requirement exists at all is a computable binary — decided
    // here in code from the JD's own parsed requirements, not left to the model's own
    // null/non-null judgement (which the prompt asks for, but a model under no
    // pressure to be right about a null can still invent a plausible-looking number).
    // Same reasoning that already keeps keyword/semantic scoring out of the model's
    // hands entirely.
    const jdHasEducationRequirement =
      ctx.jd.parsedData?.requirements.some((r) => r.category === 'education') ??
      false;

    const { data: graded } = await this.ai.complete<AtsGrading>({
      feature: 'ats_grading',
      promptKey: 'ats_grading',
      variables: {
        jd_summary: this.renderJd(ctx.jd),
        resume_summary: this.renderResume(ctx.sections),
        keyword_evidence: this.renderKeywords(matchData.keywords),
        semantic_evidence: this.renderSemantic(
          matchData.semantic.perRequirement,
        ),
        format_issues:
          format.issues.join('\n') || 'No formatting issues detected',
      },
      truncateVariable: 'resume_summary',
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      runId: ctx.runId,
      stepName: 'score_ats',
    });

    const components: Array<{
      component: string;
      score: number | null;
      weight: number;
    }> = [
      { component: 'keyword', score: keyword.score, weight: WEIGHTS.keyword },
      { component: 'semantic', score: semantic, weight: WEIGHTS.semantic },
      {
        component: 'experience',
        score: clamp(graded.experienceScore),
        weight: WEIGHTS.experience,
      },
      {
        component: 'education',
        // null = the JD has no education requirement — excluded below, NOT zeroed
        // (which would cap everyone at 90) and NOT scored 100 (free points). The
        // decision of whether to score at all is forced by jdHasEducationRequirement,
        // not by the model's own null; a model returning a number for a JD with no
        // education requirement can no longer hand out 10 free points.
        score: jdHasEducationRequirement
          ? clamp(graded.educationScore ?? 50)
          : null,
        weight: WEIGHTS.education,
      },
      {
        component: 'project',
        score: clamp(graded.projectScore),
        weight: WEIGHTS.project,
      },
      { component: 'format', score: format.score, weight: WEIGHTS.format },
      {
        component: 'grammar',
        score: clamp(graded.grammarScore),
        weight: WEIGHTS.grammar,
      },
    ];

    // Renormalise over whatever WAS assessed — the score means "of what was actually
    // assessed, how well did you do", not "you're missing 10% of your possible points".
    const active = components.filter(
      (c): c is { component: string; score: number; weight: number } =>
        c.score !== null,
    );
    const totalWeight = active.reduce((n, c) => n + c.weight, 0);

    const breakdown: ScoreBreakdownEntry[] = active.map((c) => ({
      component: c.component,
      score: c.score,
      weight: c.weight,
      contribution: Number(((c.score * c.weight) / totalWeight).toFixed(2)),
    }));

    const overall = Math.round(
      active.reduce((sum, c) => sum + c.score * c.weight, 0) / totalWeight,
    );

    const report = await this.reports.save(
      this.reports.create({
        workspaceId: ctx.workspaceId,
        runId: ctx.runId,
        overallScore: overall,
        keywordScore: keyword.score,
        semanticScore: semantic,
        experienceScore: clamp(graded.experienceScore),
        educationScore: jdHasEducationRequirement
          ? clamp(graded.educationScore ?? 50)
          : null,
        projectScore: clamp(graded.projectScore),
        formatScore: format.score,
        grammarScore: clamp(graded.grammarScore),
        scoreBreakdown: breakdown,
        summary: graded.summary,
        strengths: graded.strengths,
        weaknesses: [...graded.weaknesses, ...format.issues],
        recommendations: graded.recommendations,
      }),
    );

    if (matchData.keywords.length) {
      await this.matches.save(
        matchData.keywords.map((k) =>
          this.matches.create({
            atsReportId: report.id,
            keyword: k.keyword,
            canonical: k.canonical ?? null,
            category: k.category,
            importance: k.importance,
            status: k.status,
            evidence: k.evidence ?? null,
            foundIn: k.foundIn ?? [],
            suggestion: k.suggestion ?? null,
          }),
        ),
      );
    }

    return report;
  }

  private renderJd(jd: JobDescription): string {
    const d = jd.parsedData;
    if (!d) return `Position: ${jd.position}`;
    const lines = [
      `Position: ${d.position}${d.company ? ` at ${d.company}` : ''}`,
      `Seniority: ${d.seniority}`,
      d.experienceRequired
        ? `Experience required: ${d.experienceRequired}`
        : '',
      '',
      'Requirements:',
      ...d.requirements.map((r) => `- [${r.importance}] ${r.text}`),
      '',
      'Responsibilities:',
      ...d.responsibilities.map((r) => `- ${r}`),
    ];
    return lines.filter((l) => l !== '').join('\n');
  }

  /** Reuses ChunkerService's per-section prose rendering rather than duplicating it. */
  private renderResume(sections: PipelineContext['sections']): string {
    return this.chunker
      .chunkResume(sections)
      .map((c) => c.content)
      .join('\n\n');
  }

  private renderKeywords(keywords: KeywordMatch[]): string {
    if (!keywords.length) return 'No skills to compare.';
    return keywords
      .map(
        (k) =>
          `- ${k.keyword} (${k.importance}): ${k.status}` +
          (k.evidence ? ` — "${k.evidence}"` : ''),
      )
      .join('\n');
  }

  private renderSemantic(perRequirement: ScoredRequirement[]): string {
    if (!perRequirement.length) return 'No requirements to compare.';
    return perRequirement
      .map(
        (r) =>
          `- [${r.importance}] "${r.requirement}" -> ${r.verdict} (${r.score}/100)` +
          (r.foundIn ? `, found in: ${r.foundIn}` : ''),
      )
      .join('\n');
  }
}
