import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Resume } from '../resumes/entities/resume.entity';
import { ResumeSection } from '../resumes/entities/resume-section.entity';
import { ResumeVersion } from './entities/resume-version.entity';
import { AiSuggestion } from '../suggestions/entities/ai-suggestion.entity';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { GeneratedDocument } from '../documents/entities/generated-document.entity';
import { AtsReport } from '../ats/entities/ats-report.entity';
import { AtsKeywordMatch } from '../ats/entities/ats-keyword-match.entity';
import { ResumeVersionsService } from './resume-versions.service';
import { ResumeVersionsController } from './resume-versions.controller';
import { SuggestionsController } from './suggestions.controller';
import { FabricationGuardService } from '../suggestions/services/fabrication-guard.service';

/**
 * API-safe: applying/restoring/diffing versions is pure DB manipulation, no AI call —
 * unlike SuggestionsModule (worker-only), this can live directly in the API process.
 * FabricationGuardService is added directly (not imported via SuggestionsModule) since
 * it's a stateless, dependency-free utility — same pattern CoverLetterModule already
 * uses — needed here to re-check a user-submitted needs_info detail before accepting it.
 * AtsReport/AtsKeywordMatch are bare repos (not AtsModule) for the same reason
 * WorkspacesModule registers them directly — provideDetail() needs the JD's gap
 * keywords for the guard's keyword check, not the worker-only AI/embeddings graph.
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
      AtsReport,
      AtsKeywordMatch,
    ]),
  ],
  controllers: [ResumeVersionsController, SuggestionsController],
  providers: [ResumeVersionsService, FabricationGuardService],
  exports: [ResumeVersionsService],
})
export class ResumeVersionsModule {}
