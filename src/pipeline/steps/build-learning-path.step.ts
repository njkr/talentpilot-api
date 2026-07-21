import { Injectable } from '@nestjs/common';
import { PipelineStep, PipelineContext, StepResult } from './step.interface';
import { STEP_MANIFEST } from './step-manifest';
import { LearningRoadmapService } from '../../learning-roadmap/learning-roadmap.service';

const META = STEP_MANIFEST.build_learning_path;

@Injectable()
export class BuildLearningPathStep extends PipelineStep {
  readonly name = 'build_learning_path';
  readonly label = 'Building your learning roadmap';
  readonly dependsOn = META.dependsOn; // ['score_ats'] — needs the gap list
  readonly progressWeight = META.progressWeight;
  readonly creditWeight = META.creditWeight;

  constructor(private readonly roadmap: LearningRoadmapService) {
    super();
  }

  async run(ctx: PipelineContext): Promise<StepResult> {
    const roadmap = await this.roadmap.generate(ctx);
    return {
      outputRef: `learning_roadmaps:${roadmap.id}`,
      preview: { count: roadmap.items.length },
    };
  }
}
