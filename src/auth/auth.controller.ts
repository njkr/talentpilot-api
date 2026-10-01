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
import { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { EmailDto } from './dto/email.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { SessionResponseDto } from './dto/session-response.dto';
import { SessionInfoResponse } from './dto/session-info-response.dto';
import { Env } from 'src/config/config.module';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { User } from './entities/user.entity';
import { Problems } from 'src/common/problems';
import { reqCtx } from 'src/common/utils/req-ctx.util';
import {
  ApiDataResponse,
  ApiErrorResponses,
  ApiNoContentResponse,
} from 'src/common/swagger/api-response.decorator';

const REFRESH_COOKIE = 'tp_rt';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly env: Env,
  ) {}

  private setRefreshCookie(res: Response, raw: string) {
    // COOKIE_CROSS_SITE overrides this independent of NODE_ENV — e.g. a local backend
    // tunnelled (ngrok) to a deployed frontend is cross-site even in dev. Deliberately
    // NOT tied to DATABASE_SSL: which origins the frontend lives on and whether the DB
    // needs TLS are unrelated facts about an environment.
    const crossSite =
      this.env.get('COOKIE_CROSS_SITE') ??
      this.env.get('NODE_ENV') === 'production';
    res.cookie(REFRESH_COOKIE, raw, {
      httpOnly: true, // JS cannot read it → XSS cannot steal the session
      secure: crossSite,
      // 'strict'/'lax' only work when frontend and API share a site — cross-site
      // deployments (e.g. Vercel + Render, or this ngrok test) never send it
      // otherwise, since 'lax' only allows top-level navigation, not fetch/XHR.
      // 'none' requires secure:true (browsers reject SameSite=None without it,
      // which is why both flip together). The CORS allowlist (APP_URL/
      // CORS_ORIGINS, credentials:true) is what actually restricts which origins
      // can complete the round trip, not the cookie's SameSite value.
      sameSite: crossSite ? 'none' : 'lax',
      path: '/api/v1/auth', // never sent to any other route
      maxAge: this.env.get('REFRESH_TTL_DAYS') * 86_400_000,
    });
  }

  @Public()
  @Post('register')
  @HttpCode(201)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Create an account',
    description:
      'Creates an unverified account and emails a 6-digit OTP. Registration deliberately ' +
      'leaks whether an email is taken (409) — that surface is defended by rate limiting, ' +
      'not by lying, so the frontend can tell the user their email is already registered.',
  })
  @ApiDataResponse(
    201,
    UserResponseDto,
    'Account created. No session yet — verify the OTP to log in.',
  )
  @ApiErrorResponses({
    400: 'Validation failed (bad email format, weak password).',
    409: 'An account with this email already exists.',
    429: 'More than 5 requests/min from this IP.',
  })
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    const user = await this.auth.register(dto, reqCtx(req));
    return new UserResponseDto(user); // 201 + user. No session until verified.
  }

  @Public()
  @Post('verify-email')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Confirm the OTP and log in',
    description:
      'Consumes the 6-digit code and, on success, issues a session — verifying logs you ' +
      'straight in. Idempotent: calling this again for an already-verified account just logs you in.',
  })
  @ApiDataResponse(
    200,
    SessionResponseDto,
    'Verified. Access token returned; refresh token set as an httpOnly cookie.',
  )
  @ApiErrorResponses({
    400: 'Wrong/expired code (OTP_INVALID / OTP_EXPIRED), or validation failed.',
    429: 'Too many incorrect codes (OTP_MAX_ATTEMPTS) or rate-limited.',
  })
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
  @ApiOperation({
    summary: 'Resend the verification OTP',
    description:
      'Always returns 204, even for an unknown or already-verified email — existence is ' +
      'never revealed. Subject to a per-account cooldown (OTP_RESEND_COOLDOWN_SEC) on top of the IP rate limit.',
  })
  @ApiNoContentResponse(
    204,
    'Always — including when the email is unknown or already verified.',
  )
  @ApiErrorResponses({
    400: 'Validation failed (bad email format).',
    429: 'Resend requested before the cooldown elapsed (OTP_COOLDOWN), or rate-limited.',
  })
  async resend(@Body() dto: EmailDto) {
    await this.auth.resendOtp(dto.email);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } }) // S1-03: 5/min/IP
  @ApiOperation({
    summary: 'Log in with email + password',
    description:
      'Unverified users can still log in (so the frontend can show the OTP screen with a ' +
      'session) — routes requiring a verified email are blocked separately by VerifiedGuard. ' +
      'Unknown email and wrong password return an identical 401 body in identical time: no user-enumeration oracle.',
  })
  @ApiDataResponse(
    200,
    SessionResponseDto,
    'Access token returned; refresh token set as an httpOnly cookie.',
  )
  @ApiErrorResponses({
    401: 'Invalid email or password (deliberately identical for both cases).',
    403: 'Account suspended.',
    429: 'More than 5 attempts/min from this IP.',
  })
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
  @ApiCookieAuth('refresh_token')
  @ApiOperation({
    summary: 'Rotate the refresh token',
    description:
      'Reads the `tp_rt` httpOnly cookie, rotates it, and returns a new access token. ' +
      'Two concurrent refreshes with the same token are a race, not theft: the loser gets ' +
      'a soft 401 (TOKEN_SUPERSEDED) and should retry with its current token, not log out. ' +
      'A token replayed well after rotation is treated as theft: the whole device family is revoked.',
  })
  @ApiDataResponse(
    200,
    SessionResponseDto,
    'Rotated. A new refresh cookie is set.',
  )
  @ApiErrorResponses({
    401: 'No/invalid/expired cookie (TOKEN_INVALID), reused-after-theft (also TOKEN_INVALID + family revoked), or a benign concurrent-refresh race (TOKEN_SUPERSEDED — retry, do not log out).',
  })
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
  @ApiBearerAuth('access-token')
  @ApiCookieAuth('refresh_token')
  @ApiOperation({
    summary: 'Log out the current device',
    description:
      'Revokes the whole refresh-token family (not just the current token) and clears the ' +
      'cookie. Idempotent — calling it with no/expired cookie still returns 204.',
  })
  @ApiNoContentResponse(204, 'Always, even if there was no active session.')
  @ApiErrorResponses({ 401: 'Missing/invalid access token.' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (raw) await this.auth.logout(raw);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(204)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Request a password reset email',
    description:
      'Always returns 204 — existence of the email is never revealed.',
  })
  @ApiNoContentResponse(204, 'Always, including for an unknown email.')
  @ApiErrorResponses({
    400: 'Validation failed (bad email format).',
    429: 'More than 5 requests/min from this IP.',
  })
  async forgot(@Body() dto: EmailDto, @Req() req: Request) {
    await this.auth.forgotPassword(dto.email, reqCtx(req)); // always 204, always
  }

  @Public()
  @Post('reset-password')
  @HttpCode(204)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Set a new password',
    description:
      'Consumes the single-use reset token, rehashes the password, bumps tokenVersion ' +
      '(instantly invalidating every live access token), and revokes every refresh token — ' +
      'this is "log out everywhere" by construction.',
  })
  @ApiNoContentResponse(
    204,
    'Password changed; every session (this device and others) is now signed out.',
  )
  @ApiErrorResponses({
    400: 'Reset link invalid/expired (RESET_TOKEN_INVALID), or the new password fails validation.',
    429: 'More than 5 requests/min from this IP.',
  })
  async reset(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    await this.auth.resetPassword(dto, reqCtx(req));
  }

  @Get('sessions')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'List active sessions (devices)',
    description:
      'One row per active refresh-token family — a "manage devices" screen.',
  })
  @ApiDataResponse(200, SessionInfoResponse, 'Active sessions, newest first.', {
    isArray: true,
  })
  @ApiErrorResponses({ 401: 'Missing/invalid access token.' })
  async sessions(@CurrentUser() user: User) {
    return (await this.auth.listSessions(user.id)).map(
      (t) => new SessionInfoResponse(t),
    );
  }

  @Delete('sessions/:familyId')
  @HttpCode(204)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Revoke a session (sign out a device)',
    description:
      'Revokes the whole family identified by familyId (from GET /auth/sessions).',
  })
  @ApiNoContentResponse(204, 'That device is signed out.')
  @ApiErrorResponses({
    401: 'Missing/invalid access token.',
    404: 'No session with that familyId belongs to the current user.',
  })
  async revoke(
    @CurrentUser() user: User,
    @Param('familyId', ParseUUIDPipe) fid: string,
  ) {
    await this.auth.revokeSession(user.id, fid);
  }
}
