import { CoverLetterService } from './cover-letter.service';

function build() {
  const complete = jest.fn();
  const ai = { complete } as any;
  const chunker = { chunkResume: jest.fn().mockReturnValue([]) } as any;
  const credits = {
    debit: jest.fn().mockResolvedValue(undefined),
    balance: jest.fn().mockResolvedValue(10),
  };
  const letters = {
    update: jest.fn().mockResolvedValue(undefined),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn((x) => x),
    save: jest.fn((x) => Promise.resolve({ id: 'letter-1', ...x })),
    findOne: jest.fn(),
  };
  const insights = { findOne: jest.fn().mockResolvedValue(null) };
  const workspaces = {
    findOne: jest.fn().mockResolvedValue({
      id: 'ws-1',
      resumeId: 'r-1',
      jobDescriptionId: 'jd-1',
    }),
  };
  const resumes = {
    findOne: jest.fn().mockResolvedValue({ id: 'r-1', currentVersion: 1 }),
  };
  const sections = { find: jest.fn().mockResolvedValue([]) };
  const jds = {
    findOne: jest
      .fn()
      .mockResolvedValue({ position: 'Engineer', parsedData: null }),
  };

  const service = new CoverLetterService(
    ai,
    chunker,
    credits as any,
    letters as any,
    insights as any,
    workspaces as any,
    resumes as any,
    sections as any,
    jds as any,
  );

  const ctx = {
    userId: 'user-1',
    workspaceId: 'ws-1',
    runId: 'run-1',
    resume: {},
    sections: [],
    jd: { position: 'Engineer', parsedData: null },
  } as any;

  return { service, complete, credits, letters, workspaces, ctx };
}

describe('CoverLetterService.generate', () => {
  it('rejects a cover letter that contains unfilled placeholders', async () => {
    const { service, complete, ctx } = build();
    complete.mockResolvedValue({
      data: { content: 'Dear [Hiring Manager] at [Company], ...' },
      usage: {},
    });

    await expect(service.generate(ctx)).rejects.toMatchObject({
      code: 'AI_OUTPUT_INVALID',
    });
  });

  it('saves a clean letter and marks it current', async () => {
    const { service, complete, letters, ctx } = build();
    complete.mockResolvedValue({
      data: { content: 'Dear Hiring Team, I am excited about this role...' },
      usage: {},
    });

    const letter = await service.generate(ctx);

    expect(letters.update).toHaveBeenCalledWith(
      { workspaceId: 'ws-1' },
      { isCurrent: false },
    );
    expect(letter.content).toContain('excited about this role');
  });
});

describe('CoverLetterService.regenerateForWorkspace', () => {
  it('throws INSUFFICIENT_CREDITS before ever calling the AI', async () => {
    const { service, credits, complete } = build();
    credits.balance.mockResolvedValue(0);

    await expect(
      service.regenerateForWorkspace('ws-1', 'user-1'),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_CREDITS' });
    expect(complete).not.toHaveBeenCalled();
  });

  it('does NOT charge the user when generation fails (e.g. placeholder guard)', async () => {
    const { service, credits, complete } = build();
    complete.mockResolvedValue({
      data: { content: 'Dear [Hiring Manager], ...' },
      usage: {},
    });

    await expect(
      service.regenerateForWorkspace('ws-1', 'user-1'),
    ).rejects.toMatchObject({ code: 'AI_OUTPUT_INVALID' });
    expect(credits.debit).not.toHaveBeenCalled();
  });

  it('charges exactly once, only after generation succeeds', async () => {
    const { service, credits, complete } = build();
    complete.mockResolvedValue({
      data: { content: 'Dear Hiring Team, excited about this opportunity...' },
      usage: {},
    });

    await service.regenerateForWorkspace('ws-1', 'user-1', {
      tone: 'confident',
    });

    expect(credits.debit).toHaveBeenCalledTimes(1);
    expect(credits.debit).toHaveBeenCalledWith(
      'user-1',
      2,
      'cover_letter_regenerate',
      'ws-1',
    );
  });
});
