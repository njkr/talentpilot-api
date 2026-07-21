import { ApiProperty } from '@nestjs/swagger';
import { PipelineRun } from '../../pipeline/entities/pipeline-run.entity';
import { PipelineStep } from '../../pipeline/entities/pipeline-step.entity';

export class RunStepResponse {
  @ApiProperty() name: string;
  @ApiProperty() status: string;
  @ApiProperty({ nullable: true }) error: string | null;

  constructor(s: PipelineStep) {
    Object.assign(this, { name: s.name, status: s.status, error: s.error });
  }
}

/** Same state shape as the SSE `snapshot` event — one FE reducer handles both. */
export class RunResponse {
  @ApiProperty() id: string;
  @ApiProperty() workspaceId: string;
  @ApiProperty() status: string;
  @ApiProperty() progress: number;
  @ApiProperty({ nullable: true }) currentStep: string | null;
  @ApiProperty() creditsCharged: number;
  @ApiProperty() creditsRefunded: number;
  @ApiProperty({ nullable: true }) error: string | null;
  @ApiProperty({ type: [RunStepResponse] }) steps: RunStepResponse[];

  constructor(run: PipelineRun, steps: PipelineStep[]) {
    Object.assign(this, {
      id: run.id,
      workspaceId: run.workspaceId,
      status: run.status,
      progress: run.progress,
      currentStep: run.currentStep,
      creditsCharged: run.creditsCharged,
      creditsRefunded: run.creditsRefunded,
      error: run.error,
      steps: steps.map((s) => new RunStepResponse(s)),
    });
  }
}
