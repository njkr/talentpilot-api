import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PipelineCommonModule } from './pipeline-common.module';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { Resume } from '../resumes/entities/resume.entity';
import { ResumeSection } from '../resumes/entities/resume-section.entity';
import { JobDescription } from '../job-descriptions/entities/job-description.entity';
import { AtsModule } from '../ats/ats.module';
import { AiModule } from '../ai/ai.module';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { JobDescriptionsModule } from '../job-descriptions/job-descriptions.module';
import { CreditsModule } from '../credits/credits.module';
import { ResumeParserService } from '../resumes/services/resume-parser.service';
import { ContextHydrator } from './context-hydrator.service';
import { StepRunner } from './step-runner.service';
import { StepRegistry } from './steps/step.registry';
import { ParseResumeStep } from './steps/parse-resume.step';
import { ParseJdStep } from './steps/parse-jd.step';
import { GenerateEmbeddingsStep } from './steps/generate-embeddings.step';
import { MatchKeywordsStep } from './steps/match-keywords.step';
import { ScoreAtsStep } from './steps/score-ats.step';

/**
 * Worker-only: the actual step-execution machinery (StepRunner + the 5 steps + their
 * transitive AI/embeddings/ATS dependencies). Split from PipelineCommonModule so the
 * API process — which only orchestrates runs (create/status/SSE) — never pulls this in.
 */
@Module({
  imports: [
    PipelineCommonModule,
    TypeOrmModule.forFeature([
      Workspace,
      Resume,
      ResumeSection,
      JobDescription,
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
    StepRegistry,
    ContextHydrator,
    StepRunner,
  ],
  exports: [StepRunner],
})
export class PipelineWorkerModule {}
