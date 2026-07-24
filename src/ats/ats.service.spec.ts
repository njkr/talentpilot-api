import { AtsService } from './ats.service';

const REQUIREMENTS_WITH_EDUCATION = [
  {
    text: '5+ years backend experience',
    category: 'experience',
    importance: 'required',
  },
  {
    text: "Bachelor's degree in Computer Science or related field",
    category: 'education',
    importance: 'preferred',
  },
];
const REQUIREMENTS_WITHOUT_EDUCATION = [
  {
    text: '5+ years backend experience',
    category: 'experience',
    importance: 'required',
  },
  {
    text: 'Strong TypeScript skills',
    category: 'technical',
    importance: 'required',
  },
];

function build(
  gradedOverrides: Partial<Record<string, unknown>> = {},
  requirements: unknown[] = REQUIREMENTS_WITH_EDUCATION,
) {
  const complete = jest.fn().mockResolvedValue({
    data: {
      experienceScore: 70,
      educationScore: 60,
      projectScore: 80,
      grammarScore: 90,
      grammarIssues: [],
      summary: 'summary',
      strengths: [],
      weaknesses: [],
      recommendations: [],
      ...gradedOverrides,
    },
  });
  const ai = { complete } as any;
  const formatScorer = {
    score: jest.fn().mockReturnValue({ score: 90, issues: [] }),
  } as any;
  const keywordScorer = {
    score: jest.fn().mockReturnValue({ score: 91 }),
  } as any;
  const chunker = { chunkResume: jest.fn().mockReturnValue([]) } as any;

  const savedReports: any[] = [];
  const reports = {
    create: jest.fn((x) => x),
    save: jest.fn((x) => {
      const saved = { id: `report-${savedReports.length}`, ...x };
      savedReports.push(saved);
      return Promise.resolve(saved);
    }),
  } as any;
  const matches = {
    create: jest.fn((x) => x),
    save: jest.fn().mockResolvedValue(undefined),
  } as any;

  const service = new AtsService(
    ai,
    formatScorer,
    keywordScorer,
    chunker,
    reports,
    matches,
  );

  const ctx = {
    runId: 'run-1',
    workspaceId: 'ws-1',
    userId: 'user-1',
    resume: {},
    resumeVersion: 1,
    sections: [],
    jd: {
      position: 'Engineer',
      parsedData: {
        position: 'Engineer',
        seniority: 'mid',
        experienceRequired: '5+ years',
        requirements,
        responsibilities: [],
      },
    },
    artifacts: new Map(),
  } as any;
  const matchData = {
    semantic: { semanticScore: 28, perRequirement: [] },
    keywords: [],
  } as any;

  return { service, ai, ctx, matchData, complete, matches };
}

describe('AtsService.generate', () => {
  it('computes the overall score as the fixed weighted formula, not an AI value', async () => {
    const { service, ctx, matchData } = build();
    const report = await service.generate(ctx, matchData);

    // keyword .30*91 + semantic .20*28 + experience .15*70 + education .10*60
    // + project .10*80 + format .10*90 + grammar .05*90, over full weight 1.0
    const expected = Math.round(
      0.3 * 91 +
        0.2 * 28 +
        0.15 * 70 +
        0.1 * 60 +
        0.1 * 80 +
        0.1 * 90 +
        0.05 * 90,
    );
    expect(report.overallScore).toBe(expected);
    expect(report.keywordScore).toBe(91);
    expect(report.semanticScore).toBe(28);
  });

  it('excludes education from the score (renormalizing weights) rather than zeroing it', async () => {
    const { service, ctx, matchData } = build(
      { educationScore: null },
      REQUIREMENTS_WITHOUT_EDUCATION,
    );
    const report = await service.generate(ctx, matchData);

    expect(report.educationScore).toBeNull();
    // Same components minus education; renormalized over weight 0.90.
    const weightedSum =
      0.3 * 91 + 0.2 * 28 + 0.15 * 70 + 0.1 * 80 + 0.1 * 90 + 0.05 * 90;
    const expected = Math.round(weightedSum / 0.9);
    expect(report.overallScore).toBe(expected);
    expect(
      report.scoreBreakdown.find((c: any) => c.component === 'education'),
    ).toBeUndefined();
  });

  it('forces educationScore to null when the JD has no education requirement, even if the model returns a number anyway', async () => {
    // The prompt tells the model to return null here, but nothing stops a model
    // under no real pressure from inventing a plausible-looking score instead —
    // this is exactly the "10 free points" failure mode: whether to score education
    // at all must be decided from the JD's own parsed requirements in code, not
    // trusted to the model's own null/non-null judgement.
    const { service, ctx, matchData } = build(
      { educationScore: 95 },
      REQUIREMENTS_WITHOUT_EDUCATION,
    );
    const report = await service.generate(ctx, matchData);

    expect(report.educationScore).toBeNull();
    expect(
      report.scoreBreakdown.find((c: any) => c.component === 'education'),
    ).toBeUndefined();
  });

  it('clamps out-of-range AI scores into [0, 100]', async () => {
    const { service, ctx, matchData } = build({
      experienceScore: 150,
      projectScore: -20,
    });
    const report = await service.generate(ctx, matchData);

    expect(report.experienceScore).toBe(100);
    expect(report.projectScore).toBe(0);
  });

  it('is deterministic for identical inputs (pure arithmetic, not a second AI call)', async () => {
    const { service, ctx, matchData, complete } = build();
    const first = await service.generate(ctx, matchData);
    const second = await service.generate(ctx, matchData);

    expect(second.overallScore).toBe(first.overallScore);
    expect(complete).toHaveBeenCalledTimes(2); // one grading call per generate(), each identical
  });

  it('persists one keyword-match row per input match', async () => {
    const { service, ctx, matches } = build();
    const matchData = {
      semantic: { semanticScore: 50, perRequirement: [] },
      keywords: [
        {
          keyword: 'Go',
          canonical: 'go',
          category: 'language',
          importance: 'required',
          status: 'matched',
          foundIn: ['skills'],
        },
        {
          keyword: 'Rust',
          canonical: 'rust',
          category: 'language',
          importance: 'preferred',
          status: 'missing',
          foundIn: [],
        },
      ],
    } as any;

    await service.generate(ctx, matchData);

    expect(matches.save).toHaveBeenCalledWith([
      expect.objectContaining({ keyword: 'Go', status: 'matched' }),
      expect.objectContaining({ keyword: 'Rust', status: 'missing' }),
    ]);
  });
});
