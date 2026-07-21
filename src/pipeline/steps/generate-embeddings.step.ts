import { Injectable } from '@nestjs/common';
import { PipelineStep, PipelineContext, StepResult } from './step.interface';
import { STEP_MANIFEST } from './step-manifest';
import { ChunkerService } from '../../embeddings/services/chunker.service';
import { EmbeddingsService } from '../../embeddings/embeddings.service';

const META = STEP_MANIFEST.generate_embeddings;

@Injectable()
export class GenerateEmbeddingsStep extends PipelineStep {
  readonly name = 'generate_embeddings';
  readonly label = 'Analyzing resume and job description content';
  readonly dependsOn = META.dependsOn;
  readonly progressWeight = META.progressWeight;
  readonly creditWeight = META.creditWeight;

  constructor(
    private readonly chunker: ChunkerService,
    private readonly embeddings: EmbeddingsService,
  ) {
    super();
  }

  async run(ctx: PipelineContext): Promise<StepResult> {
    // Independent network round-trips — embed both sides in parallel.
    const [resumeStats, jdStats] = await Promise.all([
      this.embeddings.embedOwner(
        'resume',
        ctx.resume.id,
        ctx.resumeVersion,
        this.chunker.chunkResume(ctx.sections),
        ctx.userId,
      ),
      this.embeddings.embedOwner(
        'job_description',
        ctx.jd.id,
        1,
        this.chunker.chunkJd(ctx.jd),
        ctx.userId,
      ),
    ]);

    return { preview: { resume: resumeStats, jd: jdStats } };
  }
}
