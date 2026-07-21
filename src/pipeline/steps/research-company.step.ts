import { Injectable } from '@nestjs/common';
import { PipelineStep, PipelineContext, StepResult } from './step.interface';
import { STEP_MANIFEST } from './step-manifest';
import { CompanyService } from '../../company/company.service';

const META = STEP_MANIFEST.research_company;

@Injectable()
export class ResearchCompanyStep extends PipelineStep {
  readonly name = 'research_company';
  readonly label = 'Researching the company';
  readonly dependsOn = META.dependsOn;
  readonly progressWeight = META.progressWeight;
  readonly creditWeight = META.creditWeight;
  readonly required = false; // Tavily down (or no company name) must not fail the whole run

  constructor(private readonly company: CompanyService) {
    super();
  }

  async run(ctx: PipelineContext): Promise<StepResult> {
    const insight = await this.company.research(ctx);
    return {
      outputRef: `company_insights:${insight.id}`,
      preview: { confidence: insight.confidence },
    };
  }
}
