import { createHash } from 'crypto';
import { ResumeVersionsService } from './resume-versions.service';
import { ResumeSection } from '../resumes/entities/resume-section.entity';
import { ResumeVersion } from './entities/resume-version.entity';
import { AiSuggestion } from '../suggestions/entities/ai-suggestion.entity';
import { Workspace } from '../workspaces/entities/workspace.entity';

function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function experienceSection(highlights: string[]) {
  return {
    id: 'sec-1',
    resumeId: 'resume-1',
    version: 1,
    sectionType: 'experience' as const,
    content: [
      {
        company: 'Acme Corp',
        title: 'Engineer',
        location: null,
        startDate: '2020',
        endDate: null,
        isCurrent: true,
        highlights,
      },
    ],
    orderIndex: 0,
    confidence: null,
    aiGenerated: false,
    editedByUser: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function suggestion(overrides: Partial<AiSuggestion> = {}) {
  return {
    id: 'sug-1',
    workspaceId: 'ws-1',
    runId: 'run-1',
    sectionType: 'experience' as const,
    itemIndex: 0,
    bulletIndex: 0,
    oldText: 'Old bullet',
    oldTextHash: hash('Old bullet'),
    newText: 'New bullet',
    reason: 'reason',
    impact: 'high' as const,
    keywordsAdded: [],
    status: 'pending' as const,
    appliedVersion: null,
    decidedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function fakeManager(sections: any[]) {
  const saved: any[] = [];
  const updates: any[] = [];
  return {
    saved,
    updates,
    find: jest.fn((entity: unknown) => {
      if (entity === ResumeSection) return Promise.resolve(sections);
      return Promise.resolve([]);
    }),
    findOne: jest.fn((entity: unknown) => {
      if (entity === Workspace) {
        return Promise.resolve({ id: 'ws-1', name: 'Acme — Backend Engineer' });
      }
      return Promise.resolve(null);
    }),
    create: jest.fn((_entity: unknown, data: unknown) => data),
    save: jest.fn((entity: unknown, data: unknown) => {
      saved.push({ entity, data });
      return Promise.resolve(data);
    }),
    update: jest.fn((entity: unknown, criteria: unknown, patch: unknown) => {
      updates.push({ entity, criteria, patch });
      return Promise.resolve({ affected: 1 });
    }),
  };
}

function build() {
  const resumes = { findOne: jest.fn() };
  const sections = { find: jest.fn() };
  const versions = { find: jest.fn() };
  const suggestions = { find: jest.fn(), update: jest.fn() };
  const workspaces = { findOne: jest.fn() };
  const generatedDocuments = {};
  const atsReports = { findOne: jest.fn().mockResolvedValue(null) };
  const atsKeywordMatches = { find: jest.fn().mockResolvedValue([]) };
  const dataSource = { transaction: jest.fn() };
  const guard = {
    collectKnownOrgs: jest.fn().mockReturnValue([]),
    collectKnownCertifications: jest.fn().mockReturnValue([]),
    check: jest
      .fn()
      .mockReturnValue({ safe: true, violations: [], details: [] }),
    // Mirrors the real FabricationGuardService.summariseForNeedsInfo() closely enough
    // for these tests: a keyword-type detail gets the direct-edit message, anything
    // else gets the generic deduped-join behaviour.
    summariseForNeedsInfo: jest.fn((check: any) => {
      const keywordViolations = check.details.filter(
        (d: any) => d.type === 'keyword',
      );
      if (keywordViolations.length) {
        const skills = [
          ...new Set(keywordViolations.map((d: any) => d.value)),
        ].join(', ');
        return {
          missingFact: `${skills} isn't evidenced anywhere in your resume — add it to your Skills section directly if it's genuinely true, then re-run suggestions. Retyping text here can't fix this.`,
          exampleValue: null,
          needsDirectEdit: true,
        };
      }
      return {
        missingFact: [
          ...new Set(check.details.map((d: any) => d.missingFact)),
        ].join('; '),
        exampleValue: check.details[0]?.value ?? null,
        needsDirectEdit: false,
      };
    }),
  };

  const service = new ResumeVersionsService(
    resumes as any,
    sections as any,
    versions as any,
    suggestions as any,
    workspaces as any,
    generatedDocuments as any,
    atsReports as any,
    atsKeywordMatches as any,
    dataSource as any,
    guard as any,
  );
  return {
    service,
    resumes,
    sections,
    versions,
    suggestions,
    workspaces,
    atsReports,
    atsKeywordMatches,
    dataSource,
    guard,
  };
}

describe('ResumeVersionsService.applySuggestions', () => {
  it('applying 2 of 2 suggestions creates exactly ONE new version', async () => {
    const { service, resumes, suggestions, dataSource } = build();
    resumes.findOne.mockResolvedValue({
      id: 'resume-1',
      userId: 'user-1',
      currentVersion: 1,
    });
    const original = experienceSection(['Old bullet A', 'Old bullet B']);
    suggestions.find.mockResolvedValue([
      suggestion({
        id: 'sug-1',
        bulletIndex: 0,
        oldText: 'Old bullet A',
        oldTextHash: hash('Old bullet A'),
        newText: 'New bullet A',
      }),
      suggestion({
        id: 'sug-2',
        bulletIndex: 1,
        oldText: 'Old bullet B',
        oldTextHash: hash('Old bullet B'),
        newText: 'New bullet B',
      }),
    ]);

    let manager: ReturnType<typeof fakeManager>;
    dataSource.transaction.mockImplementation(async (cb: any) => {
      manager = fakeManager([original]);
      return cb(manager);
    });

    const result = await service.applySuggestions(
      'resume-1',
      'user-1',
      ['sug-1', 'sug-2'],
      'ws-1',
    );

    expect(result).toEqual({ version: 2, applied: 2, skipped: [] });
    // Exactly one ResumeVersion row saved.
    const versionSaves = manager!.saved.filter(
      (s) => s.entity === ResumeVersion,
    );
    expect(versionSaves).toHaveLength(1);
    expect(versionSaves[0].data.suggestionsApplied).toBe(2);
    // Both suggestions marked accepted.
    const suggestionUpdates = manager!.updates.filter(
      (u) => u.entity === AiSuggestion,
    );
    expect(suggestionUpdates).toHaveLength(2);
    expect(suggestionUpdates.every((u) => u.patch.status === 'accepted')).toBe(
      true,
    );
  });

  it('refuses a suggestion if the bullet was hand-edited first, and the edit survives', async () => {
    const { service, resumes, suggestions, dataSource } = build();
    resumes.findOne.mockResolvedValue({
      id: 'resume-1',
      userId: 'user-1',
      currentVersion: 1,
    });
    // The user has since edited this bullet — no longer matches oldTextHash.
    const edited = experienceSection(['A hand-edited bullet']);
    suggestions.find.mockResolvedValue([
      suggestion({
        id: 'sug-1',
        oldText: 'Old bullet',
        oldTextHash: hash('Old bullet'),
      }),
    ]);

    let manager: ReturnType<typeof fakeManager>;
    dataSource.transaction.mockImplementation(async (cb: any) => {
      manager = fakeManager([edited]);
      return cb(manager);
    });

    const result = await service.applySuggestions(
      'resume-1',
      'user-1',
      ['sug-1'],
      'ws-1',
    );

    expect(result.applied).toBe(0);
    expect(result.skipped).toContain('sug-1');
    // Marked stale, not silently dropped.
    const staleUpdate = manager!.updates.find(
      (u) => u.entity === AiSuggestion && u.patch.status === 'stale',
    );
    expect(staleUpdate).toBeTruthy();
    // No new version created for a no-op apply.
    expect(
      manager!.saved.filter((s) => s.entity === ResumeVersion),
    ).toHaveLength(0);
    // The user's edit is untouched — content wasn't overwritten.
    expect(edited.content[0].highlights).toEqual(['A hand-edited bullet']);
  });

  it('v1 sections are not mutated when v2 is created (deep clone, not reference)', async () => {
    const { service, resumes, suggestions, dataSource } = build();
    resumes.findOne.mockResolvedValue({
      id: 'resume-1',
      userId: 'user-1',
      currentVersion: 1,
    });
    const original = experienceSection(['Old bullet']);
    const beforeSnapshot = JSON.stringify(original.content);
    suggestions.find.mockResolvedValue([suggestion()]);

    dataSource.transaction.mockImplementation(async (cb: any) => {
      const manager = fakeManager([original]);
      return cb(manager);
    });

    await service.applySuggestions('resume-1', 'user-1', ['sug-1'], 'ws-1');

    // The original section object (standing in for "the v1 row") is untouched —
    // proves the clone(s) that got mutated were independent copies.
    expect(JSON.stringify(original.content)).toBe(beforeSnapshot);
  });
});

describe('ResumeVersionsService.restore', () => {
  it('restoring copies FORWARD as a new version, not rewriting history', async () => {
    const { service, resumes, dataSource } = build();
    resumes.findOne.mockResolvedValue({
      id: 'resume-1',
      userId: 'user-1',
      currentVersion: 3,
    });
    const v1 = experienceSection(['v1 bullet']);

    let manager: ReturnType<typeof fakeManager>;
    dataSource.transaction.mockImplementation(async (cb: any) => {
      manager = fakeManager([v1]);
      return cb(manager);
    });

    const result = await service.restore('resume-1', 'user-1', 1);

    expect(result.version).toBe(4);
    const versionSaves = manager!.saved.filter(
      (s) => s.entity === ResumeVersion,
    );
    expect(versionSaves).toHaveLength(1);
    expect(versionSaves[0].data.createdBy).toBe('restore');
    const sectionSaves = manager!.saved.filter(
      (s) => s.entity === ResumeSection,
    );
    expect(sectionSaves[0].data[0].version).toBe(4);
  });

  it('throws when the target version does not exist', async () => {
    const { service, resumes, dataSource } = build();
    resumes.findOne.mockResolvedValue({
      id: 'resume-1',
      userId: 'user-1',
      currentVersion: 2,
    });
    dataSource.transaction.mockImplementation(async (cb: any) =>
      cb(fakeManager([])),
    );

    await expect(service.restore('resume-1', 'user-1', 99)).rejects.toThrow();
  });
});

describe('ResumeVersionsService.provideDetail', () => {
  function buildForProvideDetail() {
    const built = build();
    built.workspaces.findOne.mockResolvedValue({
      id: 'ws-1',
      userId: 'user-1',
      resumeId: 'resume-1',
    });
    built.resumes.findOne.mockResolvedValue({
      id: 'resume-1',
      userId: 'user-1',
      currentVersion: 1,
      rawText: 'Some resume text',
    });
    built.sections.find.mockResolvedValue([]);
    (built.suggestions as any).findOne = jest.fn().mockResolvedValue(
      suggestion({
        status: 'needs_info',
        newText: 'e.g. improved performance by 40%',
        missingFact: 'a specific metric or number',
        exampleValue: '40%',
      }),
    );
    (built.suggestions as any).save = jest.fn((s: unknown) =>
      Promise.resolve(s),
    );
    return built;
  }

  it('flips to pending and clears missingFact/exampleValue when the user-submitted text passes the guard', async () => {
    const { service, guard, suggestions } = buildForProvideDetail();
    guard.check.mockReturnValue({ safe: true, violations: [], details: [] });

    const result = await service.provideDetail(
      'ws-1',
      'user-1',
      'sug-1',
      'Improved performance by 40%',
    );

    expect(result.status).toBe('pending');
    expect(result.missingFact).toBeNull();
    expect(result.exampleValue).toBeNull();
    expect(result.newText).toBe('Improved performance by 40%');
    expect((suggestions as any).save).toHaveBeenCalled();
  });

  it('stays needs_info with updated guidance if the user-submitted text still fails the guard', async () => {
    const { service, guard } = buildForProvideDetail();
    guard.check.mockReturnValue({
      safe: false,
      violations: ['unrecognised organisation: "Wayne Enterprises"'],
      details: [
        {
          type: 'organisation',
          value: 'Wayne Enterprises',
          missingFact: 'a specific employer, school, or organisation name',
        },
      ],
    });

    const result = await service.provideDetail(
      'ws-1',
      'user-1',
      'sug-1',
      'Worked at Wayne Enterprises',
    );

    expect(result.status).toBe('needs_info');
    expect(result.exampleValue).toBe('Wayne Enterprises');
    expect(result.missingFact).toContain('organisation');
  });

  it('404s when there is no needs_info suggestion with that id', async () => {
    const { service, suggestions } = buildForProvideDetail();
    (suggestions as any).findOne = jest.fn().mockResolvedValue(null);

    await expect(
      service.provideDetail('ws-1', 'user-1', 'ghost', 'anything'),
    ).rejects.toThrow();
  });

  it('points to direct resume editing instead of generic guidance for a keyword-type violation — retyping into this box can never satisfy it against the frozen rawText', async () => {
    const { service, guard } = buildForProvideDetail();
    guard.check.mockReturnValue({
      safe: false,
      violations: ['unsupported skill: "Cypress"'],
      details: [
        {
          type: 'keyword',
          value: 'Cypress',
          missingFact:
            "evidence that you have real Cypress experience — this isn't mentioned anywhere in your resume",
        },
      ],
    });

    const result = await service.provideDetail(
      'ws-1',
      'user-1',
      'sug-1',
      'Jest, Cypress',
    );

    expect(result.status).toBe('needs_info');
    expect(result.missingFact).toContain('Cypress');
    expect(result.missingFact).toMatch(
      /add it to your Skills section directly/,
    );
    expect(result.exampleValue).toBeNull();
  });
});
