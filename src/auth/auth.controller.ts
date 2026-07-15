import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Req,
  HttpCode,
  Res,
  ParseUUIDPipe,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { EmailDto } from './dto/email.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SessionResponseDto } from './dto/session-response.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { Env } from 'src/config/config.module';
import { Public } from './decorators/public.decorator';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from './decorators/current-user.decorator';
import { User } from './entities/user.entity';

const REFRESH_COOKIE = 'tp_rt';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly env: Env,
  ) {}

  private setRefreshCookie(res: Response, raw: string) {
    res.cookie(REFRESH_COOKIE, raw, {
      httpOnly: true, // JS cannot read it → XSS cannot steal the session
      secure: this.env.get('NODE_ENV') === 'production',
      sameSite: 'strict', // CSRF protection for the refresh endpoint
      path: '/api/v1/auth', // never sent to any other route
      maxAge: this.env.get('REFRESH_TTL_DAYS') * 86_400_000,
    });
  }

  @Public()
  @Post('register')
  @HttpCode(201)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    const user = await this.auth.register(dto, reqCtx(req));
    return new UserResponseDto(user); // 201 + user. No session until verified.
  }

  @Public()
  @Post('verify-email')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async verify(
    @Body() dto: VerifyOtpDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const s = await this.auth.verifyEmail(dto, reqCtx(req));
    this.setRefreshCookie(res, s.refreshToken);
    return { accessToken: s.accessToken, user: new UserResponseDto(s.user) };
  }

  @Public()
  @Post('resend-otp')
  @HttpCode(204)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async resend(@Body() dto: EmailDto) {
    await this.auth.resendOtp(dto.email);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } }) // S1-03: 5/min/IP
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const s = await this.auth.login(dto, reqCtx(req));
    this.setRefreshCookie(res, s.refreshToken);
    return { accessToken: s.accessToken, user: new UserResponseDto(s.user) };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (!raw) throw Problems.refreshInvalid();
    const s = await this.auth.rotateRefresh(raw, reqCtx(req));
    this.setRefreshCookie(res, s.refreshToken);
    return { accessToken: s.accessToken, user: new UserResponseDto(s.user) };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (raw) await this.auth.logout(raw);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(204)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async forgot(@Body() dto: EmailDto, @Req() req: Request) {
    await this.auth.forgotPassword(dto.email, reqCtx(req)); // always 204, always
  }

  @Public()
  @Post('reset-password')
  @HttpCode(204)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async reset(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    await this.auth.resetPassword(dto, reqCtx(req));
  }

  @Get('sessions')
  async sessions(@CurrentUser() user: User) {
    return (await this.auth.listSessions(user.id)).map(
      (t) => new SessionInfoResponse(t),
    );
  }

  @Delete('sessions/:familyId')
  @HttpCode(204)
  async revoke(
    @CurrentUser() user: User,
    @Param('familyId', ParseUUIDPipe) fid: string,
  ) {
    await this.auth.revokeSession(user.id, fid);
  }
}

// src/common/utils/req-ctx.ts
export const reqCtx = (req: Request): ReqCtx => ({
  ip: req.ip,
  userAgent: req.headers['user-agent'],
  requestId: (req as any).requestId,
});
