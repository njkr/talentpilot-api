import { Injectable } from '@nestjs/common';
import { PipelineStep, PipelineContext, StepResult } from './step.interface';
import { STEP_MANIFEST } from './step-manifest';
import { CoverLetterService } from '../../cover-letter/cover-letter.service';

const META = STEP_MANIFEST.generate_cover_letter;

@Injectable()
export class GenerateCoverLetterStep extends PipelineStep {
  readonly name = 'generate_cover_letter';
  readonly label = 'Drafting your cover letter';
  readonly dependsOn = META.dependsOn;
  readonly progressWeight = META.progressWeight;
  readonly creditWeight = META.creditWeight;

  constructor(private readonly coverLetters: CoverLetterService) {
    super();
  }

  async run(ctx: PipelineContext): Promise<StepResult> {
    const letter = await this.coverLetters.generate(ctx);
    return {
      outputRef: `cover_letters:${letter.id}`,
      preview: { wordCount: letter.wordCount },
    };
  }
}
