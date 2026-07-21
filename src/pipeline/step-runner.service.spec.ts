jest.mock('p-limit', () => ({ default: () => (fn: () => unknown) => fn() }), {
  virtual: true,
});

import { StepRunner } from './step-runner.service';
import { StepRegistry } from './steps/step.registry';
import { STEP_MANIFEST } from './steps/step-manifest';
import { AppException, ErrorCode } from '../common/exceptions/app.exception';

function fakeStep(
  name: keyof typeof STEP_MANIFEST,
  overrides: Partial<any> = {},
) {
  const meta = STEP_MANIFEST[name];
  return {
    name,
    label: name,
    dependsOn: meta.dependsOn,
    progressWeight: meta.progressWeight,
    creditWeight: meta.creditWeight,
    required: true,
    shouldSkip: jest.fn().mockResolvedValue(false),
    run: jest.fn().mockResolvedValue({}),
    ...overrides,
  };
}

function fakeStepRepo() {
  const rows = new Map<string, any>();
  return {
    find: jest.fn(async () => [...rows.values()]),
    findOne: jest.fn(async ({ where }: any) => rows.get(where.name) ?? null),
    upsert: jest.fn(async (data: any) => {
      rows.set(data.name, { ...(rows.get(data.name) ?? {}), ...data });
    }),
    createQueryBuilder: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ c: '0.000000' }),
    })),
    seed(name: string, status: string) {
      rows.set(name, { runId: 'run-1', name, status });
    },
    rows,
  };
}

function fakeRunRepo(initial: Record<string, unknown>) {
  let run: any = { id: 'run-1', ...initial };
  return {
    findOneOrFail: jest.fn(async () => ({ ...run })),
    update: jest.fn(async (_id: string, patch: any) => {
      run = { ...run, ...patch };
    }),
    get: () => run,
  };
}

function build(steps: any[]) {
  const registry = new StepRegistry(
    steps.find((s) => s.name === 'parse_resume'),
    steps.find((s) => s.name === 'parse_jd'),
    steps.find((s) => s.name === 'generate_embeddings'),
    steps.find((s) => s.name === 'match_keywords'),
    steps.find((s) => s.name === 'score_ats'),
  );

  const runRepo = fakeRunRepo({
    workspaceId: 'ws-1',
    userId: 'user-1',
    status: 'queued',
    creditsCharged: 10,
    progress: 0,
    startedAt: null,
  });
  const stepRepo = fakeStepRepo();
  const workspaces = { update: jest.fn().mockResolvedValue(undefined) };
  const bus = { publish: jest.fn() };
  const credits = { refund: jest.fn().mockResolvedValue(undefined) };
  const hydrator = {
    hydrate: jest.fn().mockResolvedValue({
      runId: 'run-1',
      workspaceId: 'ws-1',
      userId: 'user-1',
      resume: {},
      resumeVersion: 1,
      sections: [],
      jd: {},
      artifacts: new Map(),
    }),
  };

  const runner = new StepRunner(
    runRepo as any,
    stepRepo as any,
    workspaces as any,
    registry,
    bus as any,
    credits as any,
    hydrator as any,
  );

  return { runner, runRepo, stepRepo, workspaces, bus, credits };
}

function allSteps(overrides: Record<string, Partial<any>> = {}) {
  return (Object.keys(STEP_MANIFEST) as Array<keyof typeof STEP_MANIFEST>).map(
    (name) => fakeStep(name, overrides[name] ?? {}),
  );
}

describe('StepRunner.execute', () => {
  it('runs every step to completion, respecting the DAG, and finalises as completed', async () => {
    const order: string[] = [];
    const steps = allSteps(
      Object.fromEntries(
        (Object.keys(STEP_MANIFEST) as string[]).map((name) => [
          name,
          {
            run: jest.fn().mockImplementation(async () => {
              order.push(name);
              return {};
            }),
          },
        ]),
      ),
    );
    const { runner, runRepo, workspaces } = build(steps);

    await runner.execute('run-1');

    // Both roots before the thing that depends on both; each dependency before its dependent.
    expect(order.indexOf('parse_resume')).toBeLessThan(
      order.indexOf('generate_embeddings'),
    );
    expect(order.indexOf('parse_jd')).toBeLessThan(
      order.indexOf('generate_embeddings'),
    );
    expect(order.indexOf('generate_embeddings')).toBeLessThan(
      order.indexOf('match_keywords'),
    );
    expect(order.indexOf('match_keywords')).toBeLessThan(
      order.indexOf('score_ats'),
    );

    expect(runRepo.get().status).toBe('completed');
    expect(runRepo.get().progress).toBe(100);
    expect(workspaces.update).toHaveBeenCalledWith(
      'ws-1',
      expect.objectContaining({ status: 'completed' }),
    );
  });

  it('does not re-run a step already completed in a prior attempt (crash recovery)', async () => {
    const steps = allSteps();
    const { runner, stepRepo } = build(steps);
    stepRepo.seed('parse_resume', 'completed');
    stepRepo.seed('parse_jd', 'completed');

    await runner.execute('run-1');

    const parseResume = steps.find((s) => s.name === 'parse_resume')!;
    const parseJd = steps.find((s) => s.name === 'parse_jd')!;
    expect(parseResume.run).not.toHaveBeenCalled();
    expect(parseJd.run).not.toHaveBeenCalled();
    // Downstream steps still run normally.
    expect(
      steps.find((s) => s.name === 'score_ats')!.run,
    ).toHaveBeenCalledTimes(1);
  });

  it('returns immediately without touching anything if the run is already completed', async () => {
    const steps = allSteps();
    const { runner, runRepo, stepRepo } = build(steps);
    runRepo.get().status = 'completed';

    await runner.execute('run-1');

    expect(stepRepo.find).not.toHaveBeenCalled();
    for (const s of steps) expect(s.run).not.toHaveBeenCalled();
  });

  it('marks the run failed and refunds the credit weight of the failed + blocked steps', async () => {
    const failing = new AppException(ErrorCode.AI_OUTPUT_INVALID, 'boom'); // not retryable
    const steps = allSteps({
      match_keywords: { run: jest.fn().mockRejectedValue(failing) },
    });
    const { runner, runRepo, credits } = build(steps);

    await runner.execute('run-1');

    expect(runRepo.get().status).toBe('failed');
    // match_keywords (weight 3) fails; score_ats (weight 3) is blocked -> skipped.
    // Total credit weight = 2+1+2+3+3 = 11. Charged 10. Refund = round(10 * 6/11) = 5.
    expect(credits.refund).toHaveBeenCalledWith('user-1', 5, 'refund', 'run-1');
    expect(runRepo.get().creditsRefunded).toBe(5);
    expect(
      steps.find((s) => s.name === 'score_ats')!.run,
    ).not.toHaveBeenCalled();
  });

  it('retries a step once on a retryable provider error, then succeeds', async () => {
    const retryable = new AppException(
      ErrorCode.AI_PROVIDER_UNAVAILABLE,
      'down',
    );
    const run = jest
      .fn()
      .mockRejectedValueOnce(retryable)
      .mockResolvedValueOnce({});
    const steps = allSteps({ parse_resume: { run } });
    const { runner, runRepo } = build(steps);

    await runner.execute('run-1');

    expect(run).toHaveBeenCalledTimes(2);
    expect(runRepo.get().status).toBe('completed');
  });

  it('marks the run partial (not failed) when only an optional step fails', async () => {
    const failing = new AppException(ErrorCode.AI_OUTPUT_INVALID, 'boom');
    const steps = allSteps({
      score_ats: { required: false, run: jest.fn().mockRejectedValue(failing) },
    });
    const { runner, runRepo } = build(steps);

    await runner.execute('run-1');

    expect(runRepo.get().status).toBe('partial');
  });
});
