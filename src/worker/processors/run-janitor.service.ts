import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LessThan, Repository } from 'typeorm';
import { PipelineRun } from '../../pipeline/entities/pipeline-run.entity';

const ORPHAN_THRESHOLD_MS = 5 * 60_000;

/** A crash between the analyze() transaction committing and the BullMQ enqueue call
 *  leaves a `queued` run nobody will ever consume. Sweeps for those and re-enqueues them. */
@Injectable()
export class RunJanitor {
  private readonly logger = new Logger(RunJanitor.name);

  constructor(
    @InjectRepository(PipelineRun)
    private readonly runs: Repository<PipelineRun>,
    @InjectQueue('pipeline') private readonly queue: Queue,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async requeueOrphans() {
    const stuck = await this.runs.find({
      where: {
        status: 'queued',
        queuedAt: LessThan(new Date(Date.now() - ORPHAN_THRESHOLD_MS)),
      },
    });

    for (const run of stuck) {
      const job = await this.queue.getJob(run.id);
      if (!job) {
        this.logger.warn(
          `rescuing orphaned run ${run.id} — no BullMQ job found`,
        );
        await this.queue.add(
          'full-analyze',
          { runId: run.id },
          { jobId: `${run.id}:rescue` },
        );
      }
    }
  }
}
