import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PromptTemplate } from './entities/prompt-template.entity';
import { PromptsService } from './prompts.service';

@Module({
  imports: [TypeOrmModule.forFeature([PromptTemplate])],
  providers: [PromptsService],
  exports: [PromptsService],
})
export class PromptsModule {}
