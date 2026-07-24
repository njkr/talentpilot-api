import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PlanLimitService } from './plan-limit.service';
import { Resume } from 'src/resumes/entities/resume.entity';
import { Workspace } from 'src/workspaces/entities/workspace.entity';
import { Plan } from 'src/payments/entities/plan.entity';
import { Subscription } from 'src/payments/entities/subscription.entity';
import { AppException, ErrorCode } from 'src/common/exceptions/app.exception';

describe('PlanLimitService', () => {
  let service: PlanLimitService;
  let resumeCount: jest.Mock;
  let workspaceCount: jest.Mock;
  let subFindOne: jest.Mock;
  let planFindOne: jest.Mock;

  beforeEach(async () => {
    resumeCount = jest.fn();
    workspaceCount = jest.fn();
    subFindOne = jest.fn().mockResolvedValue(null);
    planFindOne = jest.fn().mockResolvedValue(null); // no seeded plans -> free fallback

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlanLimitService,
        {
          provide: getRepositoryToken(Resume),
          useValue: { count: resumeCount },
        },
        {
          provide: getRepositoryToken(Workspace),
          useValue: { count: workspaceCount },
        },
        {
          provide: getRepositoryToken(Subscription),
          useValue: { findOne: subFindOne },
        },
        {
          provide: getRepositoryToken(Plan),
          useValue: { findOne: planFindOne },
        },
      ],
    }).compile();

    service = module.get(PlanLimitService);
  });

  it('free plan (no subscription row) allows a resume under the limit', async () => {
    resumeCount.mockResolvedValueOnce(2);
    await expect(
      service.assertCanCreateResume('user-1'),
    ).resolves.toBeUndefined();
  });

  it('free plan blocks the 4th resume', async () => {
    resumeCount.mockResolvedValueOnce(3);
    let error: any;
    try {
      await service.assertCanCreateResume('user-1');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(AppException);
    expect(error.code).toBe(ErrorCode.PLAN_LIMIT_REACHED);
    expect(error.details).toEqual({ feature: 'resumes', limit: 3, current: 3 });
  });

  it('free plan blocks the 4th workspace', async () => {
    workspaceCount.mockResolvedValueOnce(3);
    await expect(
      service.assertCanCreateWorkspace('user-1'),
    ).rejects.toMatchObject({ code: ErrorCode.PLAN_LIMIT_REACHED });
  });

  it('an active paid subscription reads limits from its Plan row, not the free fallback', async () => {
    subFindOne.mockResolvedValueOnce({
      userId: 'user-1',
      planKey: 'pro',
      status: 'active',
    });
    planFindOne.mockResolvedValueOnce({
      key: 'pro',
      maxResumes: 25,
      maxWorkspaces: 100,
    });
    resumeCount.mockResolvedValueOnce(10);

    await expect(
      service.assertCanCreateResume('user-1'),
    ).resolves.toBeUndefined();
  });

  it('unlimited (-1) never throws regardless of current count', async () => {
    subFindOne.mockResolvedValueOnce({
      userId: 'user-1',
      planKey: 'ultimate',
      status: 'active',
    });
    planFindOne.mockResolvedValueOnce({
      key: 'ultimate',
      maxResumes: -1,
      maxWorkspaces: -1,
    });
    resumeCount.mockResolvedValueOnce(9999);

    await expect(
      service.assertCanCreateResume('user-1'),
    ).resolves.toBeUndefined();
    expect(resumeCount).not.toHaveBeenCalled();
  });

  it('a canceled subscription falls back to free limits, not its old plan', async () => {
    subFindOne.mockResolvedValueOnce({
      userId: 'user-1',
      planKey: 'pro',
      status: 'canceled',
    });
    resumeCount.mockResolvedValueOnce(3);

    await expect(service.assertCanCreateResume('user-1')).rejects.toMatchObject(
      {
        code: ErrorCode.PLAN_LIMIT_REACHED,
        details: { feature: 'resumes', limit: 3, current: 3 },
      },
    );
  });
});
