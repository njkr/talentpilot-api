import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LearningRoadmap } from './entities/learning-roadmap.entity';
import { AtsReport } from '../ats/entities/ats-report.entity';
import { AtsKeywordMatch } from '../ats/entities/ats-keyword-match.entity';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { LearningRoadmapService } from './learning-roadmap.service';
import { LearningRoadmapController } from './learning-roadmap.controller';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      LearningRoadmap,
      AtsReport,
      AtsKeywordMatch,
      Workspace,
    ]),
    AiModule,
  ],
  controllers: [LearningRoadmapController],
  providers: [LearningRoadmapService],
  exports: [LearningRoadmapService],
})
export class LearningRoadmapModule {}
