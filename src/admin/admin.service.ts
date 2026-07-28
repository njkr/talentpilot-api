import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { PipelineRun } from '../pipeline/entities/pipeline-run.entity';
import { PipelineStep } from '../pipeline/entities/pipeline-step.entity';
import { TokenUsage } from '../ai/entities/token-usage.entity';
import { PromptsService } from '../prompts/prompts.service';
import { PromptTemplate } from '../prompts/entities/prompt-template.entity';

const DLQ_QUEUES = ['resumes', 'pipeline', 'documents', 'emails'] as const;
export type DlqQueueName = (typeof DLQ_QUEUES)[number];

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(PipelineRun)
    private readonly runs: Repository<PipelineRun>,
    @InjectRepository(PipelineStep)
    private readonly steps: Repository<PipelineStep>,
    @InjectRepository(TokenUsage)
    private readonly tokenUsage: Repository<TokenUsage>,
    private readonly prompts: PromptsService,
    @InjectQueue('resumes') private readonly resumesQueue: Queue,
    @InjectQueue('pipeline') private readonly pipelineQueue: Queue,
    @InjectQueue('documents') private readonly documentsQueue: Queue,
    @InjectQueue('emails') private readonly emailsQueue: Queue,
  ) {}

  static readonly QUEUE_NAMES = DLQ_QUEUES;

  // ── Run inspector ──────────────────────────────────────────────────────────
  async inspectRun(runId: string) {
    const run = await this.runs.findOne({ where: { id: runId } });
    if (!run) throw new NotFoundException();
    const steps = await this.steps.find({
      where: { runId },
      order: { startedAt: 'ASC' },
    });
    return { run, steps };
  }

  // ── Dead-letter queue ────────────────────────────────────────────────────
  private queueFor(name: DlqQueueName): Queue {
    switch (name) {
      case 'resumes':
        return this.resumesQueue;
      case 'pipeline':
        return this.pipelineQueue;
      case 'documents':
        return this.documentsQueue;
      case 'emails':
        return this.emailsQueue;
    }
  }

  async listDeadLetter(name: DlqQueueName, start = 0, end = 49) {
    const jobs = await this.queueFor(name).getJobs(['failed'], start, end);
    return jobs.map((j) => ({
      id: j.id,
      name: j.name,
      data: j.data,
      attemptsMade: j.attemptsMade,
      failedReason: j.failedReason,
      timestamp: j.timestamp,
    }));
  }

  async requeueDeadLetter(name: DlqQueueName, jobId: string): Promise<void> {
    const job = await this.queueFor(name).getJob(jobId);
    if (!job) throw new NotFoundException(`No job ${jobId} in queue ${name}`);
    await job.retry();
  }

  // ── Cost breakdown ───────────────────────────────────────────────────────
  async costBreakdown(days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [byFeature, byDay, topUsers] = await Promise.all([
      this.tokenUsage
        .createQueryBuilder('u')
        .select('u.feature', 'feature')
        .addSelect('COALESCE(SUM(u.costUsd), 0)', 'costUsd')
        .addSelect('COUNT(*)', 'calls')
        .where('u.createdAt >= :since', { since })
        .groupBy('u.feature')
        .orderBy('"costUsd"', 'DESC')
        .getRawMany(),
      this.tokenUsage
        .createQueryBuilder('u')
        .select("DATE_TRUNC('day', u.createdAt)", 'day')
        .addSelect('COALESCE(SUM(u.costUsd), 0)', 'costUsd')
        .addSelect('COUNT(*)', 'calls')
        .addSelect('COUNT(*) FILTER (WHERE u.success = false)', 'errors')
        .where('u.createdAt >= :since', { since })
        .groupBy("DATE_TRUNC('day', u.createdAt)")
        .orderBy('day', 'ASC')
        .getRawMany(),
      this.tokenUsage
        .createQueryBuilder('u')
        .select('u.userId', 'userId')
        .addSelect('COALESCE(SUM(u.costUsd), 0)', 'costUsd')
        .where('u.createdAt >= :since AND u.userId IS NOT NULL', { since })
        .groupBy('u.userId')
        .orderBy('"costUsd"', 'DESC')
        .limit(20)
        .getRawMany(),
    ]);

    return { since, byFeature, byDay, topUsers };
  }

  // ── Prompt version management ───────────────────────────────────────────
  listPromptVersions(key: string): Promise<PromptTemplate[]> {
    return this.prompts.listVersions(key);
  }

  activatePrompt(key: string, version: number): Promise<void> {
    return this.prompts.activate(key, version);
  }
}
