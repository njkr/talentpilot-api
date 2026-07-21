import { SuggestionsService } from './suggestions.service';
import { FabricationGuardService } from './services/fabrication-guard.service';

function build() {
  const complete = jest.fn();
  const ai = { complete } as any;
  const guard = new FabricationGuardService();
  const suggestions = {
    create: jest.fn((x) => x),
    save: jest.fn((x) => Promise.resolve(x)),
  };
  const matches = { find: jest.fn().mockResolvedValue([]) };

  const service = new SuggestionsService(
    ai,
    guard,
    suggestions as any,
    matches as any,
  );

  const ctx = {
    runId: 'run-1',
    workspaceId: 'ws-1',
    userId: 'user-1',
    resume: { rawText: 'Improved API performance for our main service' },
    resumeVersion: 1,
    sections: [
      {
        sectionType: 'experience',
        content: [
          {
            company: 'Acme Corp',
            title: 'Engineer',
            location: null,
            startDate: '2020',
            endDate: null,
            isCurrent: true,
            highlights: ['Improved API performance'],
          },
        ],
      },
    ],
    jd: { position: 'Engineer', parsedData: null },
    artifacts: new Map(),
  } as any;

  const report = { id: 'report-1', weaknesses: [] } as any;

  return { service, ai, complete, ctx, report, suggestions };
}

function mockOptimizer(complete: jest.Mock, suggestions: any[]) {
  complete.mockResolvedValue({
    data: { suggestions, overallStrategy: 'strategy' },
    usage: {},
  });
}

describe('SuggestionsService.generate', () => {
  it('drops a suggestion that invents a metric not in the source resume', async () => {
    const { service, complete, ctx, report } = build();
    mockOptimizer(complete, [
      {
        sectionType: 'experience',
        itemIndex: 0,
        bulletIndex: 0,
        oldText: 'Improved API performance',
        newText:
          'Improved API performance by 45%, reducing latency for 2M users',
        reason: 'Addresses performance requirement',
        impact: 'high',
        keywordsAdded: [],
      },
    ]);

    const saved = await service.generate(ctx, report);
    expect(saved).toHaveLength(0);
  });

  it('keeps a suggestion that surfaces a number ALREADY in the resume', async () => {
    const { service, complete, ctx, report } = build();
    ctx.resume.rawText = 'Led migration for 40 microservices';
    ctx.sections[0].content[0].highlights = ['Led migration'];
    mockOptimizer(complete, [
      {
        sectionType: 'experience',
        itemIndex: 0,
        bulletIndex: 0,
        oldText: 'Led migration',
        newText: 'Led migration of 40 microservices to Kubernetes',
        reason: 'Surfaces scale already demonstrated',
        impact: 'medium',
        keywordsAdded: ['Kubernetes'],
      },
    ]);

    const saved = await service.generate(ctx, report);
    expect(saved).toHaveLength(1);
    expect(saved[0].newText).toContain('Kubernetes');
  });

  it('drops a suggestion that invents an employer', async () => {
    const { service, complete, ctx, report } = build();
    mockOptimizer(complete, [
      {
        sectionType: 'experience',
        itemIndex: 0,
        bulletIndex: 0,
        oldText: 'Improved API performance',
        newText: 'Collaborated with Goldman Sachs on trading infrastructure',
        reason: 'Adds prestige',
        impact: 'low',
        keywordsAdded: [],
      },
    ]);

    const saved = await service.generate(ctx, report);
    expect(saved).toHaveLength(0);
  });

  it('drops a suggestion whose oldText cannot be located in the resume', async () => {
    const { service, complete, ctx, report } = build();
    mockOptimizer(complete, [
      {
        sectionType: 'experience',
        itemIndex: 0,
        bulletIndex: 0,
        oldText: 'This text does not exist anywhere in the resume',
        newText: 'Something else entirely',
        reason: 'reason',
        impact: 'low',
        keywordsAdded: [],
      },
    ]);

    const saved = await service.generate(ctx, report);
    expect(saved).toHaveLength(0);
  });

  it('drops a no-op suggestion where newText equals oldText', async () => {
    const { service, complete, ctx, report } = build();
    mockOptimizer(complete, [
      {
        sectionType: 'experience',
        itemIndex: 0,
        bulletIndex: 0,
        oldText: 'Improved API performance',
        newText: 'improved  api   performance', // same content, different casing/spacing
        reason: 'reason',
        impact: 'low',
        keywordsAdded: [],
      },
    ]);

    const saved = await service.generate(ctx, report);
    expect(saved).toHaveLength(0);
  });

  it('stores the REAL source text as oldText, not a possibly-paraphrased model copy', async () => {
    const { service, complete, ctx, report } = build();
    mockOptimizer(complete, [
      {
        sectionType: 'experience',
        itemIndex: 0,
        bulletIndex: 0,
        oldText: 'Improved   API performance', // extra whitespace vs. the real text
        newText: 'Significantly improved API performance across the platform',
        reason: 'reason',
        impact: 'medium',
        keywordsAdded: [],
      },
    ]);

    const saved = await service.generate(ctx, report);
    expect(saved).toHaveLength(1);
    expect(saved[0].oldText).toBe('Improved API performance');
  });
});
