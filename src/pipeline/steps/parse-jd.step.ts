import { Injectable } from '@nestjs/common';
import { PipelineStep, PipelineContext, StepResult } from './step.interface';
import { STEP_MANIFEST } from './step-manifest';
import { JobDescriptionsService } from '../../job-descriptions/job-descriptions.service';

const META = STEP_MANIFEST.parse_jd;

@Injectable()
export class ParseJdStep extends PipelineStep {
  readonly name = 'parse_jd';
  readonly label = 'Reading the job description';
  readonly dependsOn = META.dependsOn;
  readonly progressWeight = META.progressWeight;
  readonly creditWeight = META.creditWeight;

  constructor(private readonly jds: JobDescriptionsService) {
    super();
  }

  /** Same reasoning as ParseResumeStep — analyze() already requires status='analyzed'. */
  async shouldSkip(ctx: PipelineContext) {
    return ctx.jd.status === 'analyzed' ? 'already analyzed' : false;
  }

  async run(ctx: PipelineContext): Promise<StepResult> {
    ctx.jd = await this.jds.analyse(ctx.jd);
    return { outputRef: `job_descriptions:${ctx.jd.id}` };
  }
}
