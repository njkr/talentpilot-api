import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ResumeSection } from '../resumes/entities/resume-section.entity';
import { ResumesModule } from '../resumes/resumes.module';
import { JobDescriptionsModule } from '../job-descriptions/job-descriptions.module';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { AiModule } from '../ai/ai.module';
import { AtsReport } from './entities/ats-report.entity';
import { AtsKeywordMatch } from './entities/ats-keyword-match.entity';
import { SemanticScorerService } from './services/semantic-scorer.service';
import { KeywordMatcherService } from './services/keyword-matcher.service';
import { FormatScorerService } from './services/format-scorer.service';
import { KeywordScorerService } from './services/keyword-scorer.service';
import { AtsService } from './ats.service';
import { MatchingFacade } from './matching.facade';
import { MatchingService } from './matching.service';
import { MatchingController } from './matching.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([ResumeSection, AtsReport, AtsKeywordMatch]),
    ResumesModule,
    JobDescriptionsModule,
    EmbeddingsModule,
    AiModule,
  ],
  controllers: [MatchingController],
  providers: [
    SemanticScorerService,
    KeywordMatcherService,
    FormatScorerService,
    KeywordScorerService,
    AtsService,
    MatchingFacade,
    MatchingService,
  ],
  // Exported for the pipeline's MatchKeywordsStep/ScoreAtsStep (worker-side), which
  // reuse these directly rather than going through MatchingFacade's bundled embed+match.
  // MatchingFacade itself is exported for RescoreProcessor (worker-side too), which
  // DOES want the bundled embed+match+score-prep — a rescore is exactly "score one
  // resume against one JD again", the one case the facade's own doc comment describes.
  exports: [
    SemanticScorerService,
    KeywordMatcherService,
    AtsService,
    MatchingFacade,
  ],
})
export class AtsModule {}
