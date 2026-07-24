import { NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';

function build() {
  const runs = { findOne: jest.fn() };
  const steps = { find: jest.fn().mockResolvedValue([]) };
  const tokenUsage = {
    createQueryBuilder: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    })),
  };
  const prompts = { listVersions: jest.fn(), activate: jest.fn() };
  const resumesQueue = { getJobs: jest.fn(), getJob: jest.fn() };
  const pipelineQueue = { getJobs: jest.fn(), getJob: jest.fn() };
  const documentsQueue = { getJobs: jest.fn(), getJob: jest.fn() };
  const emailsQueue = { getJobs: jest.fn(), getJob: jest.fn() };

  const service = new AdminService(
    runs as any,
    steps as any,
    tokenUsage as any,
    prompts as any,
    resumesQueue as any,
    pipelineQueue as any,
    documentsQueue as any,
    emailsQueue as any,
  );

  return {
    service,
    runs,
    steps,
    prompts,
    resumesQueue,
    pipelineQueue,
    documentsQueue,
    emailsQueue,
  };
}

describe('AdminService.inspectRun', () => {
  it('404s for an unknown run id', async () => {
    const { service, runs } = build();
    runs.findOne.mockResolvedValue(null);
    await expect(service.inspectRun('bad-id')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('returns the run plus every step row', async () => {
    const { service, runs, steps } = build();
    runs.findOne.mockResolvedValue({ id: 'run-1' });
    steps.find.mockResolvedValue([
      { name: 'parse_resume' },
      { name: 'score_ats' },
    ]);

    const result = await service.inspectRun('run-1');

    expect(result.run.id).toBe('run-1');
    expect(result.steps).toHaveLength(2);
  });
});

describe('AdminService dead-letter queue', () => {
  it('routes to the correct queue by name', async () => {
    const { service, documentsQueue } = build();
    documentsQueue.getJobs.mockResolvedValue([
      {
        id: 'job-1',
        name: 'generate',
        data: {},
        attemptsMade: 3,
        failedReason: 'timeout',
        timestamp: 1,
      },
    ]);

    const result = await service.listDeadLetter('documents');

    expect(documentsQueue.getJobs).toHaveBeenCalledWith(['failed'], 0, 49);
    expect(result).toEqual([
      {
        id: 'job-1',
        name: 'generate',
        data: {},
        attemptsMade: 3,
        failedReason: 'timeout',
        timestamp: 1,
      },
    ]);
  });

  it('requeues a job by calling job.retry()', async () => {
    const { service, resumesQueue } = build();
    const retry = jest.fn().mockResolvedValue(undefined);
    resumesQueue.getJob.mockResolvedValue({ retry });

    await service.requeueDeadLetter('resumes', 'job-1');

    expect(retry).toHaveBeenCalled();
  });

  it('404s when requeuing a job that no longer exists', async () => {
    const { service, emailsQueue } = build();
    emailsQueue.getJob.mockResolvedValue(null);
    await expect(service.requeueDeadLetter('emails', 'gone')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('AdminService.activatePrompt', () => {
  it('delegates straight to PromptsService.activate', async () => {
    const { service, prompts } = build();
    await service.activatePrompt('cover_letter', 3);
    expect(prompts.activate).toHaveBeenCalledWith('cover_letter', 3);
  });
});
