import { NotificationsService } from './notifications.service';

function build() {
  const notifications = {
    save: jest.fn((x) => Promise.resolve({ id: 'n-1', ...x })),
    create: jest.fn((x) => x),
    count: jest.fn(),
    update: jest.fn().mockResolvedValue(undefined),
    createQueryBuilder: jest.fn(),
  };
  const prefs = {
    findOne: jest.fn().mockResolvedValue(null),
    upsert: jest.fn().mockResolvedValue(undefined),
  };
  const users = { findOne: jest.fn() };
  const emails = { add: jest.fn().mockResolvedValue(undefined) };

  const service = new NotificationsService(
    notifications as any,
    prefs as any,
    users as any,
    emails as any,
  );

  return { service, notifications, prefs, users, emails };
}

describe('NotificationsService.create', () => {
  it('saves the notification and enqueues an email by default', async () => {
    const { service, notifications, users, emails } = build();
    users.findOne.mockResolvedValue({ id: 'user-1', email: 'a@b.com' });

    await service.create('user-1', {
      type: 'run.completed',
      title: 'Done',
      message: 'Your run finished.',
    });

    expect(notifications.save).toHaveBeenCalled();
    expect(emails.add).toHaveBeenCalledWith(
      'send',
      expect.objectContaining({ to: 'a@b.com', template: 'notification' }),
    );
  });

  it('does not enqueue an email when the user opted out of that notification type', async () => {
    const { service, prefs, emails } = build();
    prefs.findOne.mockResolvedValue({
      userId: 'user-1',
      emailDisabled: ['run.completed'],
    });

    await service.create('user-1', {
      type: 'run.completed',
      title: 'Done',
      message: 'Your run finished.',
    });

    expect(emails.add).not.toHaveBeenCalled();
  });

  it('skips the email (but still saves the in-app row) if the user no longer exists', async () => {
    const { service, notifications, users, emails } = build();
    users.findOne.mockResolvedValue(null);

    await service.create('user-1', {
      type: 'run.completed',
      title: 'Done',
      message: 'Your run finished.',
    });

    expect(notifications.save).toHaveBeenCalled();
    expect(emails.add).not.toHaveBeenCalled();
  });
});

describe('NotificationsService.unreadCount', () => {
  it('counts rows with a NULL readAt, not literally "undefined"', async () => {
    const { service, notifications } = build();
    notifications.count.mockResolvedValue(3);

    const count = await service.unreadCount('user-1');

    expect(count).toBe(3);
    const [[{ where }]] = notifications.count.mock.calls.map((c) => [c[0]]);
    expect(where.userId).toBe('user-1');
    // IsNull() produces a FindOperator, not the literal value `undefined` — asserting
    // it's an object (not undefined) guards against the TypeORM "undefined silently
    // skips the condition" pitfall this exact line was fixed for.
    expect(where.readAt).toBeDefined();
    expect(typeof where.readAt).toBe('object');
  });
});

describe('NotificationsService.setPreferences / getPreferences', () => {
  it('round-trips the email-disabled list via upsert on conflict (userId)', async () => {
    const { service, prefs } = build();
    await service.setPreferences('user-1', ['run.failed']);
    expect(prefs.upsert).toHaveBeenCalledWith(
      { userId: 'user-1', emailDisabled: ['run.failed'] },
      { conflictPaths: ['userId'] },
    );
  });

  it('defaults to an empty list when no preference row exists yet', async () => {
    const { service, prefs } = build();
    prefs.findOne.mockResolvedValue(null);
    expect(await service.getPreferences('user-1')).toEqual([]);
  });
});
