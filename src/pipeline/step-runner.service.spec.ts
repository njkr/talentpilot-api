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
  // StepRegistry's constructor takes one positional arg per real step class (12,
  // Sprints 5-8) — order matches STEP_MANIFEST's key order, which is also the order
  // StepRegistry itself constructs `this.steps` in.
  const ordered = (Object.keys(STEP_MANIFEST) as string[]).map((name) =>
    steps.find((s) => s.name === name),
  );
  const registry = new (StepRegistry as any)(...ordered);

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
  const tokenUsage = {
    createQueryBuilder: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ c: '0.000000' }),
    })),
  };
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
    tokenUsage as any,
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
    // match_keywords fails; everything that depends on it (directly or transitively)
    // is blocked: score_ats, optimize_resume, generate_cover_letter,
    // build_learning_path, and finalize (which depends on everything).
    // Lost credit weight = match_keywords(2) + score_ats(2) + optimize_resume(4) +
    // generate_cover_letter(3) + build_learning_path(1) + finalize(1) = 13.
    // Total credit weight across all 12 steps = 21. Charged 10.
    // Refund = round(10 * 13/21) = 6.
    expect(credits.refund).toHaveBeenCalledWith('user-1', 6, 'refund', 'run-1');
    expect(runRepo.get().creditsRefunded).toBe(6);
    expect(
      steps.find((s) => s.name === 'score_ats')!.run,
    ).not.toHaveBeenCalled();
    expect(
      steps.find((s) => s.name === 'finalize')!.run,
    ).not.toHaveBeenCalled();
    // Steps that only depend on parse_resume/parse_jd are unaffected.
    expect(
      steps.find((s) => s.name === 'generate_interview_qs')!.run,
    ).toHaveBeenCalledTimes(1);
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

  it('a failed optional step (research_company) yields a partial run with everything else completed', async () => {
    const failing = new Error('Tavily down');
    const steps = allSteps({
      research_company: {
        required: false, // matches the real ResearchCompanyStep's own property
        run: jest.fn().mockRejectedValue(failing),
      },
    });
    const { runner, runRepo } = build(steps);

    await runner.execute('run-1');

    expect(runRepo.get().status).toBe('partial');
    expect(runRepo.get().failedSteps).toEqual(['research_company']);
    // Nothing depends on research_company, so every other step still completes —
    // including finalize, which depends on ALL steps (research_company included) but
    // still runs because a failed OPTIONAL step still "resolves" the DAG wave.
    for (const s of steps) {
      if (s.name === 'research_company') continue;
      expect(s.run).toHaveBeenCalled();
    }
  });

  it('the JD-only branch (interview/company/salary) runs in the SAME wave as generate_embeddings, not serialised after it', async () => {
    // Both generate_interview_qs and generate_embeddings depend only on
    // parse_resume/parse_jd, so StepRunner's wave-based scheduler makes them ready at
    // the same time and runs them via the same Promise.all — this is the actual
    // mechanism behind "starts as soon as the JD is parsed, concurrently with the
    // scoring branch" (score_ats itself is two waves further down, behind
    // generate_embeddings -> match_keywords).
    const startOrder: string[] = [];
    let releaseEmbeddings!: () => void;
    const embeddingsBlocked = new Promise<void>((resolve) => {
      releaseEmbeddings = resolve;
    });

    const steps = allSteps({
      generate_embeddings: {
        run: jest.fn().mockImplementation(async () => {
          startOrder.push('generate_embeddings:start');
          await embeddingsBlocked;
          startOrder.push('generate_embeddings:end');
          return {};
        }),
      },
      generate_interview_qs: {
        run: jest.fn().mockImplementation(async () => {
          startOrder.push('generate_interview_qs:start');
          return {};
        }),
      },
      research_company: {
        run: jest.fn().mockImplementation(async () => {
          startOrder.push('research_company:start');
          return {};
        }),
      },
      estimate_salary: {
        run: jest.fn().mockImplementation(async () => {
          startOrder.push('estimate_salary:start');
          return {};
        }),
      },
    });
    const { runner } = build(steps);

    const execution = runner.execute('run-1');
    // Let the current wave's synchronous scheduling + microtasks settle while
    // generate_embeddings is still deliberately hanging.
    await new Promise((r) => setImmediate(r));

    // The three JD-only steps have already STARTED (and, being unblocked, finished)
    // even though generate_embeddings has not resolved yet — proof they were
    // scheduled in the same wave, not serialised behind it.
    expect(startOrder).toContain('generate_embeddings:start');
    expect(startOrder).not.toContain('generate_embeddings:end');
    expect(startOrder).toContain('generate_interview_qs:start');
    expect(startOrder).toContain('research_company:start');
    expect(startOrder).toContain('estimate_salary:start');

    releaseEmbeddings();
    await execution;
  });
});
