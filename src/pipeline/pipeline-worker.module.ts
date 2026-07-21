import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PipelineCommonModule } from './pipeline-common.module';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { Resume } from '../resumes/entities/resume.entity';
import { ResumeSection } from '../resumes/entities/resume-section.entity';
import { JobDescription } from '../job-descriptions/entities/job-description.entity';
import { AtsReport } from '../ats/entities/ats-report.entity';
import { AiSuggestion } from '../suggestions/entities/ai-suggestion.entity';
import { CoverLetter } from '../cover-letter/entities/cover-letter.entity';
import { InterviewQuestion } from '../interview/entities/interview-question.entity';
import { LearningRoadmap } from '../learning-roadmap/entities/learning-roadmap.entity';
import { CompanyInsight } from '../company/entities/company-insight.entity';
import { SalaryEstimate } from '../salary/entities/salary-estimate.entity';
import { TokenUsage } from '../ai/entities/token-usage.entity';
import { AtsModule } from '../ats/ats.module';
import { AiModule } from '../ai/ai.module';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { JobDescriptionsModule } from '../job-descriptions/job-descriptions.module';
import { CreditsModule } from '../credits/credits.module';
import { SuggestionsModule } from '../suggestions/suggestions.module';
import { CoverLetterModule } from '../cover-letter/cover-letter.module';
import { InterviewModule } from '../interview/interview.module';
import { LearningRoadmapModule } from '../learning-roadmap/learning-roadmap.module';
import { CompanyModule } from '../company/company.module';
import { SalaryModule } from '../salary/salary.module';
import { ResumeParserService } from '../resumes/services/resume-parser.service';
import { ContextHydrator } from './context-hydrator.service';
import { StepRunner } from './step-runner.service';
import { StepRegistry } from './steps/step.registry';
import { ParseResumeStep } from './steps/parse-resume.step';
import { ParseJdStep } from './steps/parse-jd.step';
import { GenerateEmbeddingsStep } from './steps/generate-embeddings.step';
import { MatchKeywordsStep } from './steps/match-keywords.step';
import { ScoreAtsStep } from './steps/score-ats.step';
import { OptimizeResumeStep } from './steps/optimize-resume.step';
import { GenerateCoverLetterStep } from './steps/generate-cover-letter.step';
import { GenerateInterviewStep } from './steps/generate-interview.step';
import { BuildLearningPathStep } from './steps/build-learning-path.step';
import { ResearchCompanyStep } from './steps/research-company.step';
import { EstimateSalaryStep } from './steps/estimate-salary.step';
import { FinalizeStep } from './steps/finalize.step';

/**
 * Worker-only: the actual step-execution machinery (StepRunner + all 12 steps + their
 * transitive AI/embeddings/ATS/Tavily dependencies). Split from PipelineCommonModule so
 * the API process — which only orchestrates runs (create/status/SSE) — never pulls this in.
 */
@Module({
  imports: [
    PipelineCommonModule,
    TypeOrmModule.forFeature([
      Workspace,
      Resume,
      ResumeSection,
      JobDescription,
      // Needed directly by OptimizeResumeStep (AtsReport) and FinalizeStep (all of
      // these) — a module's own forFeature() call doesn't leak into importers'
      // scopes, and each of these entities' "home" module (AtsModule,
      // SuggestionsModule, CoverLetterModule, ...) doesn't export its repo token
      // either, only its services. Same multi-registration pattern WorkspacesModule
      // already uses for AtsReport/AtsKeywordMatch (Sprint 6).
      AtsReport,
      AiSuggestion,
      CoverLetter,
      InterviewQuestion,
      LearningRoadmap,
      CompanyInsight,
      SalaryEstimate,
      // StepRunner sums per-step real spend from here (token_usage rows are already
      // tagged with runId + stepName by every AiService call).
      TokenUsage,
    ]),
    AtsModule,
    // AiModule/EmbeddingsModule/JobDescriptionsModule are ALSO imported by AtsModule
    // internally, but Nest never transitively re-exports what a module's own imports
    // export — only a module's own `exports` array is visible to importers. AtsModule
    // only exports its own services (AtsService etc.), so the steps that need these
    // three modules' services directly must import them here too.
    AiModule,
    EmbeddingsModule,
    JobDescriptionsModule,
    CreditsModule,
    SuggestionsModule,
    CoverLetterModule,
    InterviewModule,
    LearningRoadmapModule,
    CompanyModule,
    SalaryModule,
  ],
  providers: [
    // Not exported from ResumesModule's own providers list — this module owns its own
    // instance rather than reaching into WorkerModule's sibling provider list, which
    // Nest doesn't expose across modules anyway (only explicit exports are visible).
    ResumeParserService,
    ParseResumeStep,
    ParseJdStep,
    GenerateEmbeddingsStep,
    MatchKeywordsStep,
    ScoreAtsStep,
    OptimizeResumeStep,
    GenerateCoverLetterStep,
    GenerateInterviewStep,
    BuildLearningPathStep,
    ResearchCompanyStep,
    EstimateSalaryStep,
    FinalizeStep,
    StepRegistry,
    ContextHydrator,
    StepRunner,
  ],
  exports: [StepRunner],
})
export class PipelineWorkerModule {}
