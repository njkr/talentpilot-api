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
  const credits = {
    refund: jest.fn().mockResolvedValue(undefined),
    debit: jest.fn().mockResolvedValue(undefined),
    grant: jest.fn().mockResolvedValue(undefined),
  };
  const eventEmitter = { emit: jest.fn() };
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
    eventEmitter as any,
  );

  return { runner, runRepo, stepRepo, workspaces, bus, credits, eventEmitter };
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

  it('re-attempts a step that was skipped for a blocked dependency on a prior attempt, once the retry resolves that dependency (the reported bug)', async () => {
    const steps = allSteps();
    const { runner, runRepo, stepRepo } = build(steps);
    // Simulate what attempt 1 left behind: generate_cover_letter failed, so finalize
    // (which depends on it) was never run — only recorded 'skipped' with the
    // "dependency failed" marker, never actually executed.
    for (const name of [
      'parse_resume',
      'parse_jd',
      'generate_embeddings',
      'estimate_salary',
      'generate_interview_qs',
      'match_keywords',
      'score_ats',
      'optimize_resume',
      'build_learning_path',
      'research_company',
    ]) {
      stepRepo.seed(name, 'completed');
    }
    stepRepo.seed('generate_cover_letter', 'failed');
    stepRepo.rows.set('finalize', {
      runId: 'run-1',
      name: 'finalize',
      status: 'skipped',
      error: 'dependency failed',
    });
    runRepo.get().status = 'failed'; // as retry() would have left it before re-queueing

    await runner.execute('run-1');

    // generate_cover_letter's mock succeeds by default this attempt — finalize's only
    // blocking dependency is now resolved, so finalize must actually run, not be
    // treated as already "done" from the stale skip.
    expect(steps.find((s) => s.name === 'finalize')!.run).toHaveBeenCalledTimes(
      1,
    );
    expect(runRepo.get().status).toBe('completed');
  });

  it("clears a step's stale error/errorType when a retry succeeds where a prior attempt failed", async () => {
    const steps = allSteps();
    const { runner, stepRepo } = build(steps);
    stepRepo.rows.set('generate_cover_letter', {
      runId: 'run-1',
      name: 'generate_cover_letter',
      status: 'failed',
      error:
        'The AI produced an invalid result and could not complete this request.',
      errorType: 'AI_OUTPUT_INVALID',
    });

    await runner.execute('run-1'); // succeeds by default this attempt

    const row = stepRepo.rows.get('generate_cover_letter');
    expect(row.status).toBe('completed');
    expect(row.error).toBeNull();
    expect(row.errorType).toBeNull();
  });

  it('does NOT re-run a step that was genuinely skipped (shouldSkip() said so) on a prior attempt', async () => {
    const steps = allSteps();
    const { runner, stepRepo } = build(steps);
    stepRepo.seed('research_company', 'skipped'); // no error field — a real shouldSkip() skip

    await runner.execute('run-1');

    expect(
      steps.find((s) => s.name === 'research_company')!.shouldSkip,
    ).not.toHaveBeenCalled();
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

  it('reverses a prior refund when a retried run goes on to complete fully', async () => {
    const steps = allSteps();
    const { runner, runRepo, credits } = build(steps);
    // Simulate what a prior failed attempt on this exact run left behind: it was
    // proportionally refunded 6 credits.
    await runRepo.update('run-1', { creditsRefunded: 6 });

    await runner.execute('run-1');

    expect(runRepo.get().status).toBe('completed');
    expect(credits.debit).toHaveBeenCalledWith(
      'user-1',
      6,
      'retry_reversal',
      'run-1',
    );
    expect(credits.grant).not.toHaveBeenCalled();
    // The reversal is complete — nothing left owed on this run.
    expect(runRepo.get().creditsRefunded).toBe(0);
  });

  it('forces the reversal through as a negative grant when the balance is now insufficient', async () => {
    const steps = allSteps();
    const { runner, runRepo, credits } = build(steps);
    await runRepo.update('run-1', { creditsRefunded: 6 });
    credits.debit.mockRejectedValueOnce(
      new AppException(ErrorCode.INSUFFICIENT_CREDITS, 'not enough'),
    );

    await runner.execute('run-1');

    // The completed run must not be blocked by the user having since spent the
    // refunded credits elsewhere — the analysis was genuinely delivered in full.
    expect(runRepo.get().status).toBe('completed');
    expect(credits.grant).toHaveBeenCalledWith(
      'user-1',
      -6,
      'retry_reversal',
      'run-1',
    );
    expect(runRepo.get().creditsRefunded).toBe(0);
  });

  it('accumulates creditsRefunded across attempts rather than overwriting it', async () => {
    const failing = new AppException(ErrorCode.AI_OUTPUT_INVALID, 'boom');
    const steps = allSteps({
      score_ats: { run: jest.fn().mockRejectedValue(failing) },
    });
    const { runner, runRepo } = build(steps);
    // A previous, DIFFERENT attempt on this run already refunded 3 credits for a
    // step that has since started succeeding — this round's own refund (for
    // score_ats failing) must add to that, not replace it.
    await runRepo.update('run-1', {
      creditsRefunded: 3,
      refundedSteps: ['some_other_step'],
    });

    await runner.execute('run-1');

    expect(runRepo.get().creditsRefunded).toBeGreaterThan(3);
  });

  it('does NOT re-refund a step that fails IDENTICALLY on every retry (the reported bug)', async () => {
    // A deterministic failure — e.g. a JD with no company name will make
    // generate_cover_letter fail the exact same way on every single attempt.
    // Refunding its credit weight again on every retry, with nothing tracking what
    // was already paid back, lets a permanently-broken run mint unlimited credits.
    const failing = new AppException(ErrorCode.AI_OUTPUT_INVALID, 'boom'); // not retryable
    const steps = allSteps({
      match_keywords: { run: jest.fn().mockRejectedValue(failing) },
    });
    const { runner, runRepo, credits } = build(steps);
    // Simulate what a FIRST attempt already correctly refunded: match_keywords and
    // everything it blocks (score_ats, optimize_resume, generate_cover_letter,
    // build_learning_path, finalize — weight 13 of 21, charged 10 -> refund 6).
    await runRepo.update('run-1', {
      creditsRefunded: 6,
      refundedSteps: [
        'match_keywords',
        'score_ats',
        'optimize_resume',
        'generate_cover_letter',
        'build_learning_path',
        'finalize',
      ],
    });

    await runner.execute('run-1'); // a retry — the SAME steps fail again, identically

    expect(credits.refund).not.toHaveBeenCalled();
    expect(runRepo.get().creditsRefunded).toBe(6); // unchanged, not 12
  });

  it('never lets creditsRefunded exceed creditsCharged, no matter what the proportional math computes', async () => {
    const failing = new AppException(ErrorCode.AI_OUTPUT_INVALID, 'boom');
    const steps = allSteps({
      match_keywords: { run: jest.fn().mockRejectedValue(failing) },
    });
    const { runner, runRepo } = build(steps);
    // An already-corrupted prior state (as if from the pre-fix bug) — refunded is
    // already suspiciously close to charged.
    await runRepo.update('run-1', { creditsRefunded: 9, refundedSteps: [] });

    await runner.execute('run-1');

    expect(runRepo.get().creditsRefunded).toBeLessThanOrEqual(
      runRepo.get().creditsCharged,
    );
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
