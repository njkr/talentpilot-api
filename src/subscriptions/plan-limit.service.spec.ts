import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PlanLimitService } from './plan-limit.service';
import { Resume } from 'src/resumes/entities/resume.entity';
import { AppException } from 'src/common/exceptions/app.exception';
import { ErrorCode } from 'src/common/exceptions/app.exception';

describe('PlanLimitService', () => {
  let service: PlanLimitService;
  let count: jest.Mock;

  beforeEach(async () => {
    count = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlanLimitService,
        { provide: getRepositoryToken(Resume), useValue: { count } },
      ],
    }).compile();

    service = module.get(PlanLimitService);
  });

  it('free plan allows a resume under the limit', async () => {
    count.mockResolvedValueOnce(2);
    await expect(
      service.assertCanCreateResume('user-1'),
    ).resolves.toBeUndefined();
  });

  it('free plan blocks the 4th resume', async () => {
    count.mockResolvedValueOnce(3);
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
});
