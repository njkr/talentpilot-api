import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getQueueToken } from '@nestjs/bullmq';
import { ResumesService } from './resumes.service';
import { Resume } from './entities/resume.entity';
import { Workspace } from 'src/workspaces/entities/workspace.entity';
import { StorageService } from 'src/storage/storage.service';
import { FileValidatorService } from './services/file-validator.service';
import { PlanLimitService } from 'src/subscriptions/plan-limit.service';
import { Env } from 'src/config/config.module';
import { AppException } from 'src/common/exceptions/app.exception';

describe('ResumesService', () => {
  let service: ResumesService;
  let resumes: {
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    delete: jest.Mock;
    update: jest.Mock;
    softDelete: jest.Mock;
  };
  let workspaces: { find: jest.Mock };
  let plans: { assertCanCreateResume: jest.Mock };
  let validator: { validate: jest.Mock; countPdfPages: jest.Mock };

  const file = {
    buffer: Buffer.from('%PDF-1.4 fake pdf bytes'),
    size: 23,
    originalname: 'resume.pdf',
    mimetype: 'application/pdf',
  } as Express.Multer.File;

  beforeEach(async () => {
    resumes = {
      findOne: jest.fn(),
      save: jest.fn((r) => Promise.resolve({ id: 'resume-1', ...r })),
      create: jest.fn((r) => r),
      delete: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
    };
    workspaces = { find: jest.fn().mockResolvedValue([]) };
    plans = { assertCanCreateResume: jest.fn().mockResolvedValue(undefined) };
    validator = {
      validate: jest
        .fn()
        .mockResolvedValue({ ext: 'pdf', mime: 'application/pdf' }),
      countPdfPages: jest.fn().mockReturnValue(1),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResumesService,
        { provide: getRepositoryToken(Resume), useValue: resumes },
        { provide: getRepositoryToken(Workspace), useValue: workspaces },
        {
          provide: StorageService,
          useValue: { resumeKey: jest.fn(() => 'key'), put: jest.fn() },
        },
        { provide: FileValidatorService, useValue: validator },
        { provide: PlanLimitService, useValue: plans },
        { provide: getQueueToken('resumes'), useValue: { add: jest.fn() } },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        {
          provide: Env,
          useValue: {
            get: (k: string) => (k === 'MAX_RESUME_PAGES' ? 15 : 200),
          },
        },
      ],
    }).compile();

    service = module.get(ResumesService);
  });

  it('upload: returns the existing resume for an identical re-upload (dedupe)', async () => {
    resumes.findOne.mockResolvedValueOnce({ id: 'existing-resume' });
    const user = { id: 'user-1' } as any;
    const result = await service.upload(user, file);
    expect(result).toEqual({ id: 'existing-resume' });
    expect(resumes.save).not.toHaveBeenCalled(); // no new row created
  });

  it('upload: propagates the plan-limit error before touching storage', async () => {
    plans.assertCanCreateResume.mockRejectedValueOnce(
      new AppException('PLAN_LIMIT_REACHED' as any, 'limit reached'),
    );
    await expect(
      service.upload({ id: 'user-1' } as any, file),
    ).rejects.toBeInstanceOf(AppException);
    expect(validator.validate).not.toHaveBeenCalled();
  });

  it('findOwned: 404s (not 403) when the resume belongs to someone else', async () => {
    resumes.findOne.mockResolvedValueOnce(null);
    await expect(
      service.findOwned('resume-1', 'user-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('remove: blocked with RESUME_IN_USE when a workspace still references it', async () => {
    resumes.findOne.mockResolvedValueOnce({ id: 'resume-1', userId: 'user-1' });
    workspaces.find.mockResolvedValueOnce([
      { id: 'ws-1', name: 'My workspace' },
    ]);

    let error: any;
    try {
      await service.remove('resume-1', 'user-1');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(AppException);
    expect(error.details.workspaces).toEqual([
      { id: 'ws-1', name: 'My workspace' },
    ]);
    expect(resumes.softDelete).not.toHaveBeenCalled();
  });

  it('remove: soft-deletes when no workspace is blocking', async () => {
    resumes.findOne.mockResolvedValueOnce({ id: 'resume-1', userId: 'user-1' });
    await service.remove('resume-1', 'user-1');
    expect(resumes.softDelete).toHaveBeenCalledWith('resume-1');
  });

  it('retry: refuses when the resume is not in a failed state', async () => {
    resumes.findOne.mockResolvedValueOnce({
      id: 'resume-1',
      userId: 'user-1',
      status: 'parsed',
    });
    await expect(service.retry('resume-1', 'user-1')).rejects.toBeInstanceOf(
      AppException,
    );
  });
});
