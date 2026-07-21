import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ResumeSection } from '../resumes/entities/resume-section.entity';
import { ResumesModule } from '../resumes/resumes.module';
import { JobDescriptionsModule } from '../job-descriptions/job-descriptions.module';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { AiModule } from '../ai/ai.module';
import { SemanticScorerService } from './services/semantic-scorer.service';
import { KeywordMatcherService } from './services/keyword-matcher.service';
import { MatchingFacade } from './matching.facade';
import { MatchingService } from './matching.service';
import { MatchingController } from './matching.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([ResumeSection]),
    ResumesModule,
    JobDescriptionsModule,
    EmbeddingsModule,
    AiModule,
  ],
  controllers: [MatchingController],
  providers: [
    SemanticScorerService,
    KeywordMatcherService,
    MatchingFacade,
    MatchingService,
  ],
})
export class AtsModule {}
