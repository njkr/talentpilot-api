import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InterviewQuestion } from './entities/interview-question.entity';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { InterviewService } from './interview.service';
import { InterviewController } from './interview.controller';
import { AiModule } from '../ai/ai.module';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { CreditsModule } from '../credits/credits.module';

/** Dual-use, same reasoning as CoverLetterModule: pipeline step + direct API endpoints. */
@Module({
  imports: [
    TypeOrmModule.forFeature([InterviewQuestion, Workspace]),
    AiModule,
    EmbeddingsModule,
    CreditsModule,
  ],
  controllers: [InterviewController],
  providers: [InterviewService],
  exports: [InterviewService],
})
export class InterviewModule {}
