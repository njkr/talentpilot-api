import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Resume } from '../resumes/entities/resume.entity';
import { ResumeSection } from '../resumes/entities/resume-section.entity';
import { ResumeVersion } from './entities/resume-version.entity';
import { AiSuggestion } from '../suggestions/entities/ai-suggestion.entity';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { GeneratedDocument } from '../documents/entities/generated-document.entity';
import { ResumeVersionsService } from './resume-versions.service';
import { ResumeVersionsController } from './resume-versions.controller';
import { SuggestionsController } from './suggestions.controller';

/**
 * API-safe: applying/restoring/diffing versions is pure DB manipulation, no AI call —
 * unlike SuggestionsModule (worker-only), this can live directly in the API process.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Resume,
      ResumeSection,
      ResumeVersion,
      AiSuggestion,
      Workspace,
      GeneratedDocument,
    ]),
  ],
  controllers: [ResumeVersionsController, SuggestionsController],
  providers: [ResumeVersionsService],
  exports: [ResumeVersionsService],
})
export class ResumeVersionsModule {}
