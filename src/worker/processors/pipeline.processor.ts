import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { StepRunner } from '../../pipeline/step-runner.service';

@Processor('pipeline', { concurrency: 5 })
export class PipelineProcessor extends WorkerHost {
  constructor(private readonly runner: StepRunner) {
    super();
  }

  async process(job: Job<{ runId: string }>) {
    return this.runner.execute(job.data.runId);
  }
}
