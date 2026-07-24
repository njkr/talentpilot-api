import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GeneratedDocument } from './entities/generated-document.entity';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { ResumeSection } from '../resumes/entities/resume-section.entity';
import { Profile } from '../profiles/entities/profile.entity';
import { CoverLetter } from '../cover-letter/entities/cover-letter.entity';
import { AtsReport } from '../ats/entities/ats-report.entity';
import { AiSuggestion } from '../suggestions/entities/ai-suggestion.entity';
import { InterviewQuestion } from '../interview/entities/interview-question.entity';
import { CompanyInsight } from '../company/entities/company-insight.entity';
import { SalaryEstimate } from '../salary/entities/salary-estimate.entity';
import { LearningRoadmap } from '../learning-roadmap/entities/learning-roadmap.entity';
import { StorageModule } from '../storage/storage.module';
import { ResumeDocxGenerator } from './generators/resume-docx.generator';
import { CoverLetterDocxGenerator } from './generators/cover-letter-docx.generator';
import { PdfService } from './services/pdf.service';
import { TemplateService } from './services/template.service';
import { DocumentsProcessor } from '../worker/processors/documents.processor';

/**
 * Worker-only: Puppeteer/docx rendering has no business being in the API process's DI
 * graph (same split reasoning as PipelineWorkerModule/AiModule). DocumentsModule (API
 * side) only enqueues; this is what actually consumes the `documents` queue.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      GeneratedDocument,
      Workspace,
      ResumeSection,
      Profile,
      CoverLetter,
      AtsReport,
      AiSuggestion,
      InterviewQuestion,
      CompanyInsight,
      SalaryEstimate,
      LearningRoadmap,
    ]),
    BullModule.registerQueue({ name: 'documents' }),
    StorageModule,
  ],
  providers: [
    ResumeDocxGenerator,
    CoverLetterDocxGenerator,
    PdfService,
    TemplateService,
    DocumentsProcessor,
  ],
})
export class DocumentsWorkerModule {}
