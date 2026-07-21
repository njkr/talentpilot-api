import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoverLetter } from './entities/cover-letter.entity';
import { CompanyInsight } from '../company/entities/company-insight.entity';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { Resume } from '../resumes/entities/resume.entity';
import { ResumeSection } from '../resumes/entities/resume-section.entity';
import { JobDescription } from '../job-descriptions/entities/job-description.entity';
import { CoverLetterService } from './cover-letter.service';
import { CoverLetterController } from './cover-letter.controller';
import { AiModule } from '../ai/ai.module';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { CreditsModule } from '../credits/credits.module';

/**
 * Dual-use, like AtsModule: imported directly by PipelineWorkerModule (for
 * GenerateCoverLetterStep) AND by AppModule (for the manual regenerate endpoint, which
 * calls AI synchronously outside the pipeline — same pattern as the Sprint 4 Matching
 * endpoint). Exports the service and its own controller.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      CoverLetter,
      CompanyInsight,
      Workspace,
      Resume,
      ResumeSection,
      JobDescription,
    ]),
    AiModule,
    EmbeddingsModule,
    CreditsModule,
  ],
  controllers: [CoverLetterController],
  providers: [CoverLetterService],
  exports: [CoverLetterService],
})
export class CoverLetterModule {}
