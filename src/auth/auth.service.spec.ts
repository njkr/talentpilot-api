import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { AuthService } from './auth.service';
import { User } from './entities/user.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { PasswordService } from './services/password.service';
import { OtpService } from './services/otp.service';
import { TokenService } from './services/token.service';
import { AppException } from 'src/common/exceptions/app.exception';

describe('AuthService', () => {
  let service: AuthService;
  let users: {
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  let passwords: { hash: jest.Mock; verify: jest.Mock; fakeVerify: jest.Mock };

  beforeEach(async () => {
    users = {
      findOne: jest.fn(),
      save: jest.fn((u) => Promise.resolve(u)),
      create: jest.fn((u) => u),
      update: jest.fn(),
    };
    passwords = {
      hash: jest.fn(async (p: string) => `hashed:${p}`),
      verify: jest.fn(async () => false),
      fakeVerify: jest.fn(async () => undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: users },
        {
          provide: getRepositoryToken(RefreshToken),
          useValue: { find: jest.fn(), findOne: jest.fn() },
        },
        { provide: PasswordService, useValue: passwords },
        {
          provide: OtpService,
          useValue: { issueOtp: jest.fn(async () => '123456') },
        },
        {
          provide: TokenService,
          useValue: {
            issueRefresh: jest.fn(async () => ({
              raw: 'id.secret',
              entity: { id: 'id' },
            })),
            signAccess: jest.fn(async () => 'access-token'),
          },
        },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: DataSource, useValue: { transaction: jest.fn() } },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('register: rejects a duplicate email', async () => {
    users.findOne.mockResolvedValueOnce({ id: 'existing-user' });
    await expect(
      service.register({ email: 'a@x.com', password: 'Password1' } as any, {}),
    ).rejects.toBeInstanceOf(AppException);
  });

  it('login: unknown email and wrong password fail identically (no user-enumeration oracle)', async () => {
    users.findOne.mockResolvedValueOnce(null);
    let missingError: any;
    try {
      await service.login({ email: 'nobody@x.com', password: 'x' } as any, {});
    } catch (e) {
      missingError = e;
    }

    users.findOne.mockResolvedValueOnce({
      id: 'u1',
      passwordHash: 'hashed:real',
    });
    let wrongPwError: any;
    try {
      await service.login({ email: 'a@x.com', password: 'wrong' } as any, {});
    } catch (e) {
      wrongPwError = e;
    }

    expect(missingError).toBeInstanceOf(AppException);
    expect(wrongPwError).toBeInstanceOf(AppException);
    expect(missingError.getStatus()).toBe(wrongPwError.getStatus());
    expect(missingError.getResponse()).toEqual(wrongPwError.getResponse());
    expect(passwords.fakeVerify).toHaveBeenCalledTimes(1); // timing-equalizer ran for the missing user
  });
});
