import { AuditService } from './audit.service';

function build() {
  const logs = {
    save: jest.fn().mockResolvedValue(undefined),
    create: jest.fn((x) => x),
    createQueryBuilder: jest.fn(),
  };
  const service = new AuditService(logs as any);
  return { service, logs };
}

describe('AuditService.log', () => {
  it('writes a row with the given actorType/action/resourceType/resourceId', async () => {
    const { service, logs } = build();
    await service.log({
      userId: 'user-1',
      actorType: 'admin',
      action: 'admin.prompt.activate',
      resourceType: 'prompt_template',
      resourceId: null,
      metadata: { key: 'cover_letter', version: 3 },
    });

    expect(logs.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        actorType: 'admin',
        action: 'admin.prompt.activate',
        resourceType: 'prompt_template',
        metadata: { key: 'cover_letter', version: 3 },
      }),
    );
  });

  it('never throws even if the write fails — an audit failure must not break the caller', async () => {
    const { service, logs } = build();
    logs.save.mockRejectedValue(new Error('db down'));

    await expect(
      service.log({
        userId: null,
        actorType: 'system',
        action: 'x',
        resourceType: 'y',
      }),
    ).resolves.toBeUndefined();
  });
});

describe('AuditService.list', () => {
  it('applies userId/action/resourceType filters and cursor pagination', async () => {
    const { service, logs } = build();
    const rows = Array.from({ length: 21 }, (_, i) => ({
      id: `log-${i}`,
      createdAt: new Date(2024, 0, i + 1),
    }));
    const qb = {
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(rows),
    };
    logs.createQueryBuilder.mockReturnValue(qb);

    const result = await service.list(
      { userId: 'user-1', action: 'login.success', resourceType: 'auth' },
      { limit: 20 } as any,
    );

    expect(qb.andWhere).toHaveBeenCalledWith('l.user_id = :userId', {
      userId: 'user-1',
    });
    expect(qb.andWhere).toHaveBeenCalledWith('l.action = :action', {
      action: 'login.success',
    });
    expect(qb.andWhere).toHaveBeenCalledWith(
      'l.resource_type = :resourceType',
      {
        resourceType: 'auth',
      },
    );
    expect(result.hasMore).toBe(true);
    expect(result.data).toHaveLength(20);
    expect(result.nextCursor).not.toBeNull();
  });
});
