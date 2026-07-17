import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { BullModule } from '@nestjs/bullmq';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AuthListener } from './auth.listener';
import { PasswordService } from './services/password.service';
import { OtpService } from './services/otp.service';
import { TokenService } from './services/token.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { VerifiedGuard } from './guards/verified.guard';
import { RolesGuard } from './guards/roles.guard';
import { User } from './entities/user.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { VerificationToken } from './entities/verification-token.entity';
import { AuditLog } from 'src/audit/entities/audit-log.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, RefreshToken, VerificationToken, AuditLog]),
    PassportModule,
    JwtModule.register({}), // secret/TTL passed per-sign in TokenService, not here
    // ← lets AuthListener inject @InjectQueue('emails'). defaultJobOptions here governs
    //   AuthListener's .add() calls: 5 attempts with exponential backoff, per §10.
    BullModule.registerQueue({
      name: 'emails',
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    OtpService,
    TokenService,
    JwtStrategy,
    AuthListener, // ← @OnEvent handlers only fire if the class is a registered provider.
    //   Forget this line and emit() silently does nothing. No error. No email.
    VerifiedGuard,
    RolesGuard,
  ],
  exports: [AuthService, TokenService, VerifiedGuard, RolesGuard],
})
export class AuthModule {}
