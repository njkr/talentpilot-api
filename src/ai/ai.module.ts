import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TokenUsage } from './entities/token-usage.entity';
import { PromptsModule } from '../prompts/prompts.module';
import { PricingService } from './services/pricing.service';
import { TokenCounterService } from './services/token-counter.service';
import { BudgetService } from './services/budget.service';
import { AiService } from './ai.service';

@Module({
  imports: [TypeOrmModule.forFeature([TokenUsage]), PromptsModule],
  providers: [PricingService, TokenCounterService, BudgetService, AiService],
  exports: [
    AiService,
    PricingService,
    TokenCounterService,
    BudgetService,
    PromptsModule, // ResumeParserService (and other consumers) need PromptsService too
  ],
})
export class AiModule {}
