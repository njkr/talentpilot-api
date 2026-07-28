const mockStripe = {
  on: jest.fn(),
  subscriptions: { cancel: jest.fn() },
};

jest.mock('stripe', () => jest.fn().mockImplementation(() => mockStripe));

import { GdprService } from './gdpr.service';

function repo(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    delete: jest.fn().mockResolvedValue({ affected: 0 }),
    ...overrides,
  };
}

function build() {
  const env = { get: jest.fn().mockReturnValue('sk_test_x') };
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  const users = repo({ delete: jest.fn().mockResolvedValue({ affected: 1 }) });
  const resumes = repo();
  const resumeVersions = repo();
  const workspaces = repo();
  const subscriptions = repo({
    delete: jest.fn().mockResolvedValue({ affected: 0 }),
  });
  const atsReports = repo();
  const suggestions = repo();
  const coverLetters = repo();
  const interviewQuestions = repo();
  const companyInsights = repo();
  const salaryEstimates = repo();
  const roadmaps = repo();
  const generatedDocuments = repo();
  const runs = repo();
  const steps = repo();
  const creditLedger = repo();
  const tokenUsage = repo();
  const notifications = repo();
  const notificationPrefs = repo();
  const storage = { deletePrefix: jest.fn().mockResolvedValue(undefined) };
  const integrationCalls = { record: jest.fn().mockResolvedValue(undefined) };

  const service = new GdprService(
    env as any,
    queue as any,
    users as any,
    resumes as any,
    resumeVersions as any,
    workspaces as any,
    subscriptions as any,
    atsReports as any,
    suggestions as any,
    coverLetters as any,
    interviewQuestions as any,
    companyInsights as any,
    salaryEstimates as any,
    roadmaps as any,
    generatedDocuments as any,
    runs as any,
    steps as any,
    creditLedger as any,
    tokenUsage as any,
    notifications as any,
    notificationPrefs as any,
    storage as any,
    integrationCalls as any,
  );

  return {
    service,
    queue,
    users,
    resumes,
    resumeVersions,
    workspaces,
    subscriptions,
    atsReports,
    suggestions,
    coverLetters,
    runs,
    steps,
    creditLedger,
    tokenUsage,
    notifications,
    notificationPrefs,
    generatedDocuments,
    storage,
  };
}

beforeEach(() => jest.clearAllMocks());

describe('GdprService.requestExport', () => {
  it('enqueues an export job rather than collecting data inline', async () => {
    const { service, queue } = build();
    await service.requestExport('user-1');
    expect(queue.add).toHaveBeenCalledWith('export', { userId: 'user-1' });
  });
});

describe('GdprService.purgeExpired', () => {
  it('purges nobody when no account is past the 30-day grace window', async () => {
    const { service, users } = build();
    users.find.mockResolvedValue([]);
    const result = await service.purgeExpired();
    expect(result).toEqual({ purged: 0 });
    expect(users.delete).not.toHaveBeenCalled();
  });

  it('hard-deletes an account past the grace window and cleans workspace-scoped tables first', async () => {
    const {
      service,
      users,
      workspaces,
      resumes,
      runs,
      steps,
      atsReports,
      storage,
    } = build();
    users.find.mockResolvedValue([{ id: 'user-1' }]);
    workspaces.find.mockResolvedValue([{ id: 'ws-1' }, { id: 'ws-2' }]);
    resumes.find.mockResolvedValue([{ id: 'resume-1' }]);
    runs.find.mockResolvedValue([{ id: 'run-1' }]);

    const result = await service.purgeExpired();

    expect(result).toEqual({ purged: 1 });
    // Steps deleted by runId BEFORE runs themselves.
    expect(steps.delete).toHaveBeenCalledWith({ runId: expect.anything() });
    expect(runs.delete).toHaveBeenCalledWith({
      workspaceId: expect.anything(),
    });
    expect(atsReports.delete).toHaveBeenCalledWith({
      workspaceId: expect.anything(),
    });
    expect(storage.deletePrefix).toHaveBeenCalledWith('users/user-1/');
    // Hard delete, not soft — the actual purge.
    expect(users.delete).toHaveBeenCalledWith('user-1');
  });

  it('deletes resume_versions by resumeId — the one Sprint 5+ table with no real FK to resumes', async () => {
    const { service, users, resumes, resumeVersions } = build();
    users.find.mockResolvedValue([{ id: 'user-1' }]);
    resumes.find.mockResolvedValue([{ id: 'resume-1' }, { id: 'resume-2' }]);

    await service.purgeExpired();

    expect(resumeVersions.delete).toHaveBeenCalledWith({
      resumeId: expect.anything(),
    });
  });

  it('continues purging a later user even if an earlier one fails', async () => {
    const { service, users } = build();
    users.find.mockResolvedValue([{ id: 'user-fail' }, { id: 'user-ok' }]);
    users.delete
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ affected: 1 });

    const result = await service.purgeExpired();

    expect(result).toEqual({ purged: 1 });
    expect(users.delete).toHaveBeenCalledTimes(2);
  });

  it('cancels the Stripe subscription if one exists, but a Stripe failure does not block the purge', async () => {
    const { service, subscriptions, users } = build();
    users.find.mockResolvedValue([{ id: 'user-1' }]);
    subscriptions.findOne.mockResolvedValue({
      stripeSubscriptionId: 'sub_123',
    });
    mockStripe.subscriptions.cancel.mockRejectedValue(new Error('stripe down'));

    const result = await service.purgeExpired();

    expect(mockStripe.subscriptions.cancel).toHaveBeenCalledWith('sub_123');
    expect(result).toEqual({ purged: 1 });
    expect(users.delete).toHaveBeenCalledWith('user-1');
  });
});
