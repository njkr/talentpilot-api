import { LearningRoadmapService } from './learning-roadmap.service';

function build(items: Array<{ priority: string; title: string }>) {
  const complete = jest.fn().mockResolvedValue({ data: { items } });
  const ai = { complete } as any;
  const roadmaps = {
    create: jest.fn((x) => x),
    save: jest.fn((x) => Promise.resolve({ id: 'roadmap-1', ...x })),
    findOne: jest.fn(),
  };
  const reports = {
    findOne: jest.fn().mockResolvedValue({ id: 'report-1', weaknesses: [] }),
  };
  const matches = { find: jest.fn().mockResolvedValue([]) };
  const workspaces = { findOne: jest.fn() };
  const affiliateLinks = {
    findAffiliateUrl: jest.fn().mockResolvedValue(null),
  };

  const service = new LearningRoadmapService(
    ai,
    roadmaps as any,
    reports as any,
    matches as any,
    workspaces as any,
    affiliateLinks as any,
  );

  const ctx = {
    runId: 'run-1',
    workspaceId: 'ws-1',
    userId: 'user-1',
    jd: { position: 'Engineer', parsedData: null },
  } as any;

  return { service, ctx, roadmaps, workspaces, affiliateLinks };
}

describe('LearningRoadmapService.generate', () => {
  it('orders required gaps before preferred ones, regardless of the model output order', async () => {
    // Deliberately out of order — required item listed AFTER two preferred ones.
    const { service, ctx } = build([
      { priority: 'preferred', title: 'Learn GraphQL' },
      { priority: 'preferred', title: 'Learn gRPC' },
      { priority: 'required', title: 'Learn Kubernetes' },
    ]);

    const roadmap = await service.generate(ctx);

    expect(roadmap.items.map((i: any) => i.priority)).toEqual([
      'required',
      'preferred',
      'preferred',
    ]);
    expect(roadmap.items[0].title).toBe('Learn Kubernetes');
  });

  it("keeps the model's relative order within the same priority (stable sort)", async () => {
    const { service, ctx } = build([
      { priority: 'required', title: 'A' },
      { priority: 'required', title: 'B' },
      { priority: 'preferred', title: 'C' },
    ]);

    const roadmap = await service.generate(ctx);

    expect(roadmap.items.map((i: any) => i.title)).toEqual(['A', 'B', 'C']);
  });

  it('caps at 6 items even if the model returns more, keeping required items first', async () => {
    const items = [
      ...Array.from({ length: 5 }, (_, i) => ({
        priority: 'preferred',
        title: `Preferred ${i}`,
      })),
      { priority: 'required', title: 'Must learn this' },
      { priority: 'required', title: 'Also required' },
    ];
    const { service, ctx } = build(items);

    const roadmap = await service.generate(ctx);

    expect(roadmap.items).toHaveLength(6);
    expect(roadmap.items[0].title).toBe('Must learn this');
    expect(roadmap.items[1].title).toBe('Also required');
  });
});

describe('LearningRoadmapService.getForWorkspace', () => {
  it('attaches an affiliateUrl per item without touching the stored url field', async () => {
    const { service, ctx, roadmaps, workspaces, affiliateLinks } = build([]);
    workspaces.findOne.mockResolvedValue({ id: ctx.workspaceId });
    roadmaps.findOne.mockResolvedValue({
      id: 'roadmap-1',
      workspaceId: ctx.workspaceId,
      runId: ctx.runId,
      items: [
        {
          title: 'Fluent Python',
          gapReason: 'gap',
          resourceType: 'book',
          url: null,
          estHours: 10,
          priority: 'required',
        },
      ],
      createdAt: new Date(),
    });
    affiliateLinks.findAffiliateUrl.mockResolvedValue(
      'https://example.com/s?k=Fluent%20Python',
    );

    const result = await service.getForWorkspace(ctx.workspaceId, ctx.userId);

    expect(affiliateLinks.findAffiliateUrl).toHaveBeenCalledWith(
      'book',
      'Fluent Python',
    );
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        url: null,
        affiliateUrl: 'https://example.com/s?k=Fluent%20Python',
      }),
    );
  });
});
