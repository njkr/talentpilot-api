import { WorkspacesService } from './workspaces.service';

function build() {
  const workspaces = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((x) => x),
    update: jest.fn().mockResolvedValue(undefined),
    createQueryBuilder: jest.fn(),
    softDelete: jest.fn().mockResolvedValue(undefined),
  };
  const runs = {
    findOne: jest.fn(),
    findOneOrFail: jest.fn(),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const stepRows = { find: jest.fn().mockResolvedValue([]) };
  const atsReports = {
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
  };
  const keywordMatches = { find: jest.fn().mockResolvedValue([]) };
  const resumes = { findOne: jest.fn(), findOneOrFail: jest.fn() };
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  const rescoreQueue = { add: jest.fn().mockResolvedValue(undefined) };
  const resumesService = { findOwned: jest.fn().mockResolvedValue({}) };
  const jdsService = { findOwned: jest.fn().mockResolvedValue({}) };
  const credits = {
    balance: jest.fn(),
    debitWithin: jest.fn(),
    debit: jest.fn().mockResolvedValue(undefined),
  };
  const planLimits = {
    assertCanCreateWorkspace: jest.fn().mockResolvedValue(undefined),
  };
  const paymentConfig = {
    get: jest.fn().mockResolvedValue({ analyzeCost: 21, rescoreCost: 5 }),
  };
  const dataSource = { transaction: jest.fn() };

  const service = new WorkspacesService(
    workspaces as any,
    runs as any,
    stepRows as any,
    atsReports as any,
    keywordMatches as any,
    resumes as any,
    queue as any,
    rescoreQueue as any,
    resumesService as any,
    jdsService as any,
    credits as any,
    planLimits as any,
    paymentConfig as any,
    dataSource as any,
  );
  return {
    service,
    workspaces,
    runs,
    atsReports,
    keywordMatches,
    resumes,
    queue,
    rescoreQueue,
    credits,
    paymentConfig,
    dataSource,
  };
}

describe('WorkspacesService.analyze', () => {
  it('throws IDEMPOTENCY_KEY_REQUIRED when no key is given', async () => {
    const { service } = build();
    await expect(
      service.analyze('ws-1', 'user-1', undefined),
    ).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    });
  });

  it('replays the existing run for a key that was already used, without touching credits', async () => {
    const { service, workspaces, runs, credits, queue } = build();
    workspaces.findOne.mockResolvedValue({
      id: 'ws-1',
      resume: { status: 'parsed', currentVersion: 1 },
      jobDescription: { status: 'analyzed' },
    });
    runs.findOne.mockResolvedValue({ id: 'run-existing', status: 'running' });

    const result = await service.analyze('ws-1', 'user-1', 'key-1');

    expect(result).toEqual({
      run: { id: 'run-existing', status: 'running' },
      replayed: true,
    });
    expect(credits.balance).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('throws RESUME_NOT_PARSED when the resume is not ready', async () => {
    const { service, workspaces, runs } = build();
    workspaces.findOne.mockResolvedValue({
      id: 'ws-1',
      resume: { status: 'extracted', currentVersion: 1 },
      jobDescription: { status: 'analyzed' },
    });
    runs.findOne.mockResolvedValue(null);

    await expect(
      service.analyze('ws-1', 'user-1', 'key-1'),
    ).rejects.toMatchObject({
      code: 'RESUME_NOT_PARSED',
    });
  });

  it('throws JD_NOT_ANALYZED when the job description is not ready', async () => {
    const { service, workspaces, runs } = build();
    workspaces.findOne.mockResolvedValue({
      id: 'ws-1',
      resume: { status: 'parsed', currentVersion: 1 },
      jobDescription: { status: 'pending' },
    });
    runs.findOne.mockResolvedValue(null);

    await expect(
      service.analyze('ws-1', 'user-1', 'key-1'),
    ).rejects.toMatchObject({
      code: 'JD_NOT_ANALYZED',
    });
  });

  it('throws INSUFFICIENT_CREDITS before ever starting a transaction', async () => {
    const { service, workspaces, runs, credits, dataSource } = build();
    workspaces.findOne.mockResolvedValue({
      id: 'ws-1',
      resume: { status: 'parsed', currentVersion: 1 },
      jobDescription: { status: 'analyzed' },
    });
    runs.findOne.mockResolvedValue(null);
    credits.balance.mockResolvedValue(3);

    await expect(
      service.analyze('ws-1', 'user-1', 'key-1'),
    ).rejects.toMatchObject({
      code: 'INSUFFICIENT_CREDITS',
      details: { required: 21, balance: 3 },
    });
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('translates a 23505 on the active-run index into ANALYSIS_ALREADY_RUNNING', async () => {
    const { service, workspaces, runs, credits, dataSource } = build();
    workspaces.findOne.mockResolvedValue({
      id: 'ws-1',
      resume: { status: 'parsed', currentVersion: 1 },
      jobDescription: { status: 'analyzed' },
    });
    runs.findOne
      .mockResolvedValueOnce(null) // idempotency-key lookup
      .mockResolvedValueOnce({ id: 'run-active' }); // active-run lookup in the catch block
    credits.balance.mockResolvedValue(100);
    dataSource.transaction.mockRejectedValue({
      code: '23505',
      constraint: 'one_active_run_per_workspace',
    });

    await expect(
      service.analyze('ws-1', 'user-1', 'key-1'),
    ).rejects.toMatchObject({
      code: 'ANALYSIS_ALREADY_RUNNING',
      details: { runId: 'run-active' },
    });
  });

  it('enqueues the pipeline job only after the transaction commits', async () => {
    const { service, workspaces, runs, credits, dataSource, queue } = build();
    workspaces.findOne.mockResolvedValue({
      id: 'ws-1',
      resume: { status: 'parsed', currentVersion: 1 },
      jobDescription: { status: 'analyzed' },
    });
    runs.findOne.mockResolvedValue(null);
    credits.balance.mockResolvedValue(100);
    dataSource.transaction.mockImplementation(async (cb: any) =>
      cb({
        save: jest.fn().mockResolvedValue({ id: 'run-new' }),
        create: jest.fn((_e, x) => x),
      }),
    );

    const result = await service.analyze('ws-1', 'user-1', 'key-1');

    expect(result.replayed).toBe(false);
    expect(queue.add).toHaveBeenCalledWith(
      'full-analyze',
      { runId: 'run-new' },
      expect.objectContaining({ jobId: 'run-new' }),
    );
  });
});

// Chainable stand-in for TypeORM's QueryBuilder — every method list() calls returns
// `this`, and getMany() resolves to whatever rows the test configures.
function fakeQueryBuilder(rows: any[]) {
  const qb: any = {
    where: jest.fn(() => qb),
    andWhere: jest.fn(() => qb),
    orderBy: jest.fn(() => qb),
    addOrderBy: jest.fn(() => qb),
    take: jest.fn(() => qb),
    getMany: jest.fn().mockResolvedValue(rows),
  };
  return qb;
}

describe('WorkspacesService.list', () => {
  it("attaches each workspace its latest report's overallScore", async () => {
    const { service, workspaces, atsReports } = build();
    workspaces.createQueryBuilder.mockReturnValue(
      fakeQueryBuilder([{ id: 'ws-1', createdAt: new Date() }]),
    );
    atsReports.find.mockResolvedValue([
      { workspaceId: 'ws-1', overallScore: 72, createdAt: new Date() },
    ]);

    const { data, scores } = await service.list('user-1', { limit: 20 } as any);

    expect(data).toHaveLength(1);
    expect(scores.get('ws-1')).toBe(72);
  });

  it('has no entry in scores for a workspace with no report yet', async () => {
    const { service, workspaces, atsReports } = build();
    workspaces.createQueryBuilder.mockReturnValue(
      fakeQueryBuilder([{ id: 'ws-1', createdAt: new Date() }]),
    );
    atsReports.find.mockResolvedValue([]);

    const { scores } = await service.list('user-1', { limit: 20 } as any);

    expect(scores.has('ws-1')).toBe(false);
  });

  it("uses the LATEST report's score, not the original, when a workspace has been rescored", async () => {
    const { service, workspaces, atsReports } = build();
    workspaces.createQueryBuilder.mockReturnValue(
      fakeQueryBuilder([{ id: 'ws-1', createdAt: new Date() }]),
    );
    // find() is ordered createdAt DESC, so the latest report is listed first — same
    // assumption list() relies on to pick "first seen wins" per workspace.
    atsReports.find.mockResolvedValue([
      {
        workspaceId: 'ws-1',
        overallScore: 85,
        createdAt: new Date('2026-08-05'),
      },
      {
        workspaceId: 'ws-1',
        overallScore: 69,
        createdAt: new Date('2026-08-01'),
      },
    ]);

    const { scores } = await service.list('user-1', { limit: 20 } as any);

    expect(scores.get('ws-1')).toBe(85);
  });

  it('skips the extra report query entirely for an empty page', async () => {
    const { service, workspaces, atsReports } = build();
    workspaces.createQueryBuilder.mockReturnValue(fakeQueryBuilder([]));

    await service.list('user-1', { limit: 20 } as any);

    expect(atsReports.find).not.toHaveBeenCalled();
  });
});

describe('WorkspacesService.retry', () => {
  it('throws RUN_NOT_RETRYABLE for a run that is not failed/partial', async () => {
    const { service, runs } = build();
    runs.findOne.mockResolvedValue({ id: 'run-1', status: 'completed' });
    await expect(service.retry('run-1', 'user-1')).rejects.toMatchObject({
      code: 'RUN_NOT_RETRYABLE',
    });
  });

  it('requeues without recharging for a failed run', async () => {
    const { service, runs, queue } = build();
    runs.findOne.mockResolvedValue({ id: 'run-1', status: 'failed' });
    runs.findOneOrFail.mockResolvedValue({ id: 'run-1', status: 'queued' });

    await service.retry('run-1', 'user-1');

    expect(runs.update).toHaveBeenCalledWith('run-1', {
      status: 'queued',
      error: null,
      finishedAt: null,
    });
    expect(queue.add).toHaveBeenCalledWith(
      'full-analyze',
      { runId: 'run-1' },
      expect.objectContaining({
        jobId: expect.stringContaining('run-1:retry:'),
      }),
    );
  });
});

describe('WorkspacesService.getReport', () => {
  it('throws REPORT_NOT_READY when no AtsReport exists yet', async () => {
    const { service, workspaces, atsReports } = build();
    workspaces.findOne.mockResolvedValue({
      id: 'ws-1',
      userId: 'user-1',
      status: 'queued',
    });
    atsReports.findOne.mockResolvedValue(null);

    await expect(service.getReport('ws-1', 'user-1')).rejects.toMatchObject({
      code: 'REPORT_NOT_READY',
      details: { status: 'queued' },
    });
  });

  it('returns the most recent report with its keyword matches', async () => {
    const { service, workspaces, atsReports, keywordMatches } = build();
    workspaces.findOne.mockResolvedValue({
      id: 'ws-1',
      userId: 'user-1',
      status: 'completed',
    });
    atsReports.findOne.mockResolvedValue({
      id: 'report-1',
      workspaceId: 'ws-1',
      overallScore: 72,
    });
    keywordMatches.find.mockResolvedValue([
      { keyword: 'Go', status: 'matched' },
    ]);

    const result = await service.getReport('ws-1', 'user-1');

    expect(atsReports.findOne).toHaveBeenCalledWith({
      where: { workspaceId: 'ws-1' },
      order: { createdAt: 'DESC' },
    });
    expect(keywordMatches.find).toHaveBeenCalledWith({
      where: { atsReportId: 'report-1' },
    });
    expect(result.report.overallScore).toBe(72);
    expect(result.keywords).toEqual([{ keyword: 'Go', status: 'matched' }]);
    expect(result.original).toBeNull(); // only one report exists — same row both ways
  });

  it('returns a distinct "original" report once a rescore has produced a second, later one', async () => {
    const { service, workspaces, atsReports, keywordMatches } = build();
    workspaces.findOne.mockResolvedValue({
      id: 'ws-1',
      userId: 'user-1',
      status: 'completed',
    });
    const original = { id: 'report-1', workspaceId: 'ws-1', overallScore: 50 };
    const latest = { id: 'report-2', workspaceId: 'ws-1', overallScore: 88 };
    atsReports.findOne
      .mockResolvedValueOnce(latest) // order: createdAt DESC
      .mockResolvedValueOnce(original); // order: createdAt ASC
    keywordMatches.find.mockResolvedValue([]);

    const result = await service.getReport('ws-1', 'user-1');

    expect(result.report.overallScore).toBe(88);
    expect(result.original?.overallScore).toBe(50);
  });
});

describe('WorkspacesService.rescore', () => {
  it('throws NO_CHANGES_TO_RESCORE when the resume version matches the last report', async () => {
    const { service, workspaces, resumes, atsReports } = build();
    workspaces.findOne.mockResolvedValue({
      id: 'ws-1',
      userId: 'user-1',
      resumeId: 'resume-1',
    });
    resumes.findOneOrFail.mockResolvedValue({
      id: 'resume-1',
      currentVersion: 1,
    });
    atsReports.findOne.mockResolvedValue({ resumeVersion: 1 });

    await expect(service.rescore('ws-1', 'user-1')).rejects.toMatchObject({
      code: 'NO_CHANGES_TO_RESCORE',
    });
  });

  it('throws REPORT_NOT_READY when no report exists yet', async () => {
    const { service, workspaces, resumes, atsReports } = build();
    workspaces.findOne.mockResolvedValue({
      id: 'ws-1',
      userId: 'user-1',
      resumeId: 'resume-1',
      status: 'queued',
    });
    resumes.findOneOrFail.mockResolvedValue({
      id: 'resume-1',
      currentVersion: 2,
    });
    atsReports.findOne.mockResolvedValue(null);

    await expect(service.rescore('ws-1', 'user-1')).rejects.toMatchObject({
      code: 'REPORT_NOT_READY',
    });
  });

  it('throws INSUFFICIENT_CREDITS without debiting or enqueuing', async () => {
    const { service, workspaces, resumes, atsReports, credits, rescoreQueue } =
      build();
    workspaces.findOne.mockResolvedValue({
      id: 'ws-1',
      userId: 'user-1',
      resumeId: 'resume-1',
    });
    resumes.findOneOrFail.mockResolvedValue({
      id: 'resume-1',
      currentVersion: 2,
    });
    atsReports.findOne.mockResolvedValue({ resumeVersion: 1 });
    credits.balance.mockResolvedValue(2); // less than rescoreCost (5)

    await expect(service.rescore('ws-1', 'user-1')).rejects.toMatchObject({
      code: 'INSUFFICIENT_CREDITS',
    });
    expect(credits.debit).not.toHaveBeenCalled();
    expect(rescoreQueue.add).not.toHaveBeenCalled();
  });

  it('debits rescoreCost and enqueues a rescore job when the resume actually changed', async () => {
    const { service, workspaces, resumes, atsReports, credits, rescoreQueue } =
      build();
    workspaces.findOne.mockResolvedValue({
      id: 'ws-1',
      userId: 'user-1',
      resumeId: 'resume-1',
    });
    resumes.findOneOrFail.mockResolvedValue({
      id: 'resume-1',
      currentVersion: 2,
    });
    atsReports.findOne.mockResolvedValue({ resumeVersion: 1 });
    credits.balance.mockResolvedValue(100);

    const result = await service.rescore('ws-1', 'user-1');

    expect(result).toEqual({ queued: true });
    expect(credits.debit).toHaveBeenCalledWith('user-1', 5, 'rescore', 'ws-1');
    expect(rescoreQueue.add).toHaveBeenCalledWith('rescore', {
      workspaceId: 'ws-1',
      userId: 'user-1',
    });
  });
});
