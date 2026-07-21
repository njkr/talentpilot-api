import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SalaryEstimate } from './entities/salary-estimate.entity';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { SalaryService } from './salary.service';
import { SalaryController } from './salary.controller';
import { AiModule } from '../ai/ai.module';
import { CompanyModule } from '../company/company.module'; // for TavilyService

@Module({
  imports: [
    TypeOrmModule.forFeature([SalaryEstimate, Workspace]),
    AiModule,
    CompanyModule,
  ],
  controllers: [SalaryController],
  providers: [SalaryService],
  exports: [SalaryService],
})
export class SalaryModule {}
