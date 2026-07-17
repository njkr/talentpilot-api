import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { Env } from 'src/config/config.module';

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            register: jest.fn(),
            verifyEmail: jest.fn(),
            resendOtp: jest.fn(),
            login: jest.fn(),
            rotateRefresh: jest.fn(),
            logout: jest.fn(),
            forgotPassword: jest.fn(),
            resetPassword: jest.fn(),
            listSessions: jest.fn(),
            revokeSession: jest.fn(),
          },
        },
        {
          provide: Env,
          useValue: {
            get: jest.fn((k: string) =>
              k === 'REFRESH_TTL_DAYS' ? 30 : 'test',
            ),
          },
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
