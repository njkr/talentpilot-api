import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CompanyResearchCache } from './entities/company-research-cache.entity';
import { CompanyInsight } from './entities/company-insight.entity';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { CompanyService } from './company.service';
import { CompanyController } from './company.controller';
import { TavilyService } from './services/tavily.service';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CompanyResearchCache, CompanyInsight, Workspace]),
    AiModule,
  ],
  controllers: [CompanyController],
  providers: [CompanyService, TavilyService],
  exports: [CompanyService, TavilyService],
})
export class CompanyModule {}
