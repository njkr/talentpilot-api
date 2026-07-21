import { Injectable } from '@nestjs/common';
import { PipelineStep, PipelineContext, StepResult } from './step.interface';
import { STEP_MANIFEST } from './step-manifest';
import { SalaryService } from '../../salary/salary.service';

const META = STEP_MANIFEST.estimate_salary;

@Injectable()
export class EstimateSalaryStep extends PipelineStep {
  readonly name = 'estimate_salary';
  readonly label = 'Estimating salary range';
  readonly dependsOn = META.dependsOn;
  readonly progressWeight = META.progressWeight;
  readonly creditWeight = META.creditWeight;
  readonly required = false; // an estimate is a nice-to-have, not worth failing the run over

  constructor(private readonly salary: SalaryService) {
    super();
  }

  async run(ctx: PipelineContext): Promise<StepResult> {
    const estimate = await this.salary.generate(ctx);
    return {
      outputRef: `salary_estimates:${estimate.id}`,
      preview: { p50: estimate.p50, currency: estimate.currency },
    };
  }
}
