import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ProfilesService } from './profiles.service';
import { Profile } from './entities/profile.entity';

describe('ProfilesService', () => {
  let service: ProfilesService;
  let repo: {
    findOne: jest.Mock;
    create: jest.Mock;
    upsert: jest.Mock;
    findOneOrFail: jest.Mock;
  };

  beforeEach(async () => {
    repo = {
      findOne: jest.fn(),
      create: jest.fn((p) => p),
      upsert: jest.fn(),
      findOneOrFail: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfilesService,
        { provide: getRepositoryToken(Profile), useValue: repo },
      ],
    }).compile();

    service = module.get(ProfilesService);
  });

  it('get() returns an empty shell (not an error) when no profile exists yet', async () => {
    repo.findOne.mockResolvedValueOnce(null);
    const p = await service.get('user-1');
    // Every nullable field must be explicit `null`, not `undefined` — JSON.stringify
    // silently drops `undefined` keys, so an omitted default would vanish from the
    // actual HTTP response instead of coming back as null.
    expect(p).toEqual({
      userId: 'user-1',
      firstName: null,
      lastName: null,
      phone: null,
      linkedin: null,
      github: null,
      portfolio: null,
      country: null,
      city: null,
      timezone: null,
      yearsExperience: null,
      targetRole: null,
      salaryExpectation: null,
      salaryCurrency: null,
    });
    expect(service.completeness(p)).toBe(0);
  });

  it('completeness is 100% when every nudge field is filled', () => {
    const full = {
      firstName: 'Jane',
      lastName: 'Doe',
      city: 'SF',
      country: 'US',
      yearsExperience: 5,
      targetRole: 'Engineer',
      linkedin: 'https://linkedin.com/in/jane',
    } as Profile;
    expect(service.completeness(full)).toBe(100);
  });

  it('completeness is proportional when some fields are missing', () => {
    const partial = {
      firstName: 'Jane',
      lastName: null,
      city: null,
      country: null,
      yearsExperience: null,
      targetRole: null,
      linkedin: null,
    } as Profile;
    // 1 of 7 fields filled → round(1/7 * 100) = 14
    expect(service.completeness(partial)).toBe(14);
  });

  it('upsert writes through to the repo and re-reads the saved row', async () => {
    repo.findOneOrFail.mockResolvedValueOnce({
      userId: 'user-1',
      firstName: 'Jane',
    });
    const result = await service.upsert('user-1', { firstName: 'Jane' });
    expect(repo.upsert).toHaveBeenCalledWith(
      { userId: 'user-1', firstName: 'Jane' },
      { conflictPaths: ['userId'], skipUpdateIfNoValuesChanged: true },
    );
    expect(result).toEqual({ userId: 'user-1', firstName: 'Jane' });
  });
});
