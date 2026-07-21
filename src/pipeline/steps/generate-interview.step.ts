import { Injectable } from '@nestjs/common';
import { PipelineStep, PipelineContext, StepResult } from './step.interface';
import { STEP_MANIFEST } from './step-manifest';
import { InterviewService } from '../../interview/interview.service';

const META = STEP_MANIFEST.generate_interview_qs;

@Injectable()
export class GenerateInterviewStep extends PipelineStep {
  readonly name = 'generate_interview_qs';
  readonly label = 'Preparing interview questions';
  readonly dependsOn = META.dependsOn; // ['parse_resume', 'parse_jd'] — NOT score_ats
  readonly progressWeight = META.progressWeight;
  readonly creditWeight = META.creditWeight;

  constructor(private readonly interview: InterviewService) {
    super();
  }

  async run(ctx: PipelineContext): Promise<StepResult> {
    const questions = await this.interview.generate(ctx);
    return {
      outputRef: `interview_questions:${ctx.workspaceId}`,
      preview: { count: questions.length },
    };
  }
}
