import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Embedding } from './entities/embedding.entity';
import { ChunkerService } from './services/chunker.service';
import { EmbeddingsService } from './embeddings.service';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [TypeOrmModule.forFeature([Embedding]), AiModule],
  providers: [ChunkerService, EmbeddingsService],
  exports: [ChunkerService, EmbeddingsService],
})
export class EmbeddingsModule {}
