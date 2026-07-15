import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PasswordService } from './services/password.service';
import { OtpService } from './services/otp.service';
import { TokenService } from './services/token.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, RefreshToken, VerificationToken, AuditLog]),
    PassportModule,
    JwtModule.register({}), // secret/TTL passed per-sign in TokenService, not here
    BullModule.registerQueue({ name: 'emails' }), // ← lets AuthListener inject @InjectQueue('emails')
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
