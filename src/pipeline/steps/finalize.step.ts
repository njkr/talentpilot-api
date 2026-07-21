import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PipelineStep, PipelineContext, StepResult } from './step.interface';
import { STEP_MANIFEST } from './step-manifest';
import { AtsReport } from '../../ats/entities/ats-report.entity';
import { AiSuggestion } from '../../suggestions/entities/ai-suggestion.entity';
import { CoverLetter } from '../../cover-letter/entities/cover-letter.entity';
import { InterviewQuestion } from '../../interview/entities/interview-question.entity';
import { LearningRoadmap } from '../../learning-roadmap/entities/learning-roadmap.entity';
import { CompanyInsight } from '../../company/entities/company-insight.entity';
import { SalaryEstimate } from '../../salary/entities/salary-estimate.entity';

const META = STEP_MANIFEST.finalize;

/**
 * The DAG's sink node — depends on every other step, so it only runs once everything
 * that CAN produce output has finished (including the optional steps, whether they
 * succeeded or not: a failed optional step is still "resolved" as far as the DAG is
 * concerned by the time StepRunner reaches this point). Pure read-only aggregation, no
 * AI call — its only job is to hand the client one consolidated "here's everything this
 * run produced" summary as the final SSE preview, instead of making the UI reconstruct
 * that from nine separate outputRefs.
 */
@Injectable()
export class FinalizeStep extends PipelineStep {
  readonly name = 'finalize';
  readonly label = 'Finishing up';
  readonly dependsOn = META.dependsOn;
  readonly progressWeight = META.progressWeight;
  readonly creditWeight = META.creditWeight;

  constructor(
    @InjectRepository(AtsReport)
    private readonly reports: Repository<AtsReport>,
    @InjectRepository(AiSuggestion)
    private readonly suggestions: Repository<AiSuggestion>,
    @InjectRepository(CoverLetter)
    private readonly coverLetters: Repository<CoverLetter>,
    @InjectRepository(InterviewQuestion)
    private readonly interviewQuestions: Repository<InterviewQuestion>,
    @InjectRepository(LearningRoadmap)
    private readonly roadmaps: Repository<LearningRoadmap>,
    @InjectRepository(CompanyInsight)
    private readonly companyInsights: Repository<CompanyInsight>,
    @InjectRepository(SalaryEstimate)
    private readonly salaryEstimates: Repository<SalaryEstimate>,
  ) {
    super();
  }

  async run(ctx: PipelineContext): Promise<StepResult> {
    const [
      report,
      suggestionCount,
      coverLetter,
      interviewCount,
      roadmap,
      companyInsight,
      salaryEstimate,
    ] = await Promise.all([
      this.reports.findOne({ where: { workspaceId: ctx.workspaceId } }),
      this.suggestions.count({ where: { workspaceId: ctx.workspaceId } }),
      this.coverLetters.findOne({
        where: { workspaceId: ctx.workspaceId, isCurrent: true },
      }),
      this.interviewQuestions.count({
        where: { workspaceId: ctx.workspaceId },
      }),
      this.roadmaps.findOne({ where: { workspaceId: ctx.workspaceId } }),
      this.companyInsights.findOne({ where: { workspaceId: ctx.workspaceId } }),
      this.salaryEstimates.findOne({ where: { workspaceId: ctx.workspaceId } }),
    ]);

    return {
      preview: {
        overallScore: report?.overallScore ?? null,
        suggestionCount,
        hasCoverLetter: !!coverLetter,
        interviewQuestionCount: interviewCount,
        learningRoadmapItems: roadmap?.items.length ?? 0,
        hasCompanyInsight: !!companyInsight,
        hasSalaryEstimate: !!salaryEstimate,
      },
    };
  }
}
