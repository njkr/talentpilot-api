import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiSuggestion } from './entities/ai-suggestion.entity';
import { AtsKeywordMatch } from '../ats/entities/ats-keyword-match.entity';
import { SuggestionsService } from './suggestions.service';
import { FabricationGuardService } from './services/fabrication-guard.service';
import { AiModule } from '../ai/ai.module';

/**
 * Worker-only: SuggestionsService.generate() calls AiService, and it's only ever
 * invoked from OptimizeResumeStep inside the pipeline. Reading/applying already-
 * generated suggestions is API-safe and lives in ResumeVersionsModule instead, which
 * has no AI dependency.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AiSuggestion, AtsKeywordMatch]),
    AiModule,
  ],
  providers: [SuggestionsService, FabricationGuardService],
  exports: [SuggestionsService],
})
export class SuggestionsModule {}
