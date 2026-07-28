import { CoverLetterService } from './cover-letter.service';

function build() {
  const complete = jest.fn();
  const ai = { complete } as any;
  const chunker = { chunkResume: jest.fn().mockReturnValue([]) } as any;
  const credits = {
    debit: jest.fn().mockResolvedValue(undefined),
    balance: jest.fn().mockResolvedValue(10),
  };
  const paymentConfig = {
    get: jest.fn().mockResolvedValue({ coverLetterRegenCost: 2 }),
  };
  const guard = {
    collectKnownOrgs: jest.fn().mockReturnValue([]),
    collectKnownCertifications: jest.fn().mockReturnValue([]),
    check: jest.fn().mockReturnValue({ safe: true, violations: [] }),
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
  const generatedDocuments = { update: jest.fn().mockResolvedValue(undefined) };

  const service = new CoverLetterService(
    ai,
    chunker,
    credits as any,
    paymentConfig as any,
    guard as any,
    letters as any,
    insights as any,
    workspaces as any,
    resumes as any,
    sections as any,
    jds as any,
    generatedDocuments as any,
  );

  const ctx = {
    userId: 'user-1',
    workspaceId: 'ws-1',
    runId: 'run-1',
    resume: { rawText: 'Acme Corp — built things.' },
    sections: [],
    jd: { position: 'Engineer', company: 'Globex', parsedData: null },
  } as any;

  return { service, complete, credits, guard, letters, workspaces, ctx };
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

  it("appends the signature in code rather than trusting the model to write one — with the candidate's real name when the resume has one", async () => {
    const { service, complete, ctx } = build();
    ctx.sections = [
      {
        sectionType: 'personal_info',
        content: { fullName: 'Jamie Rivera' },
      },
    ];
    complete.mockResolvedValue({
      data: { content: 'Dear Hiring Team, I am excited about this role...' },
      usage: {},
    });

    const letter = await service.generate(ctx);

    expect(letter.content.endsWith('Sincerely,\nJamie Rivera')).toBe(true);
  });

  it('signs off with no name line when the resume has no personal_info.fullName', async () => {
    const { service, complete, ctx } = build();
    complete.mockResolvedValue({
      data: { content: 'Dear Hiring Team, I am excited about this role...' },
      usage: {},
    });

    const letter = await service.generate(ctx);

    expect(letter.content.endsWith('Sincerely,')).toBe(true);
  });

  it('rejects a letter that fails the fabrication guard (invented employer/credential/etc.)', async () => {
    const { service, complete, guard, ctx } = build();
    guard.check.mockReturnValue({
      safe: false,
      violations: ['unrecognised organisation: "Stanford University"'],
    });
    complete.mockResolvedValue({
      data: { content: 'As a Stanford University graduate, I bring...' },
      usage: {},
    });

    await expect(service.generate(ctx)).rejects.toMatchObject({
      code: 'AI_OUTPUT_INVALID',
    });
  });

  it("passes the resume's own orgs AND the JD's target company as allowed, so naming the company you're applying to is never flagged", async () => {
    const { service, complete, guard, ctx } = build();
    guard.collectKnownOrgs.mockReturnValue(['Acme Corp']);
    complete.mockResolvedValue({
      data: { content: "I'm excited to join Globex as a backend engineer..." },
      usage: {},
    });

    await service.generate(ctx);

    expect(guard.check).toHaveBeenCalledWith(
      expect.stringContaining('Globex'),
      'Acme Corp — built things.',
      ['Acme Corp'],
      ['Globex', 'Engineer'],
      [],
    );
  });

  it("also allows the JD's own position/title, so opening with the role name (as rule 3 instructs) is never flagged as a fabricated organisation", async () => {
    const { service, complete, guard, ctx } = build();
    ctx.jd = {
      position: 'Sr. Fullstack Developer',
      company: null,
      parsedData: null,
    };
    complete.mockResolvedValue({
      data: { content: 'Excited about the Sr. Fullstack Developer role...' },
      usage: {},
    });

    await service.generate(ctx);

    expect(guard.check).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(Array),
      ['', 'Sr. Fullstack Developer'],
      expect.any(Array),
    );
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
