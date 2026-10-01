import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createHash, timingSafeEqual } from 'crypto';
import { RefreshToken } from './entities/refresh-token.entity';
import { User } from './entities/user.entity';
import { Problems } from 'src/common/problems';
import { PasswordService } from './services/password.service';
import { OtpService } from './services/otp.service';
import { TokenService } from './services/token.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ReqCtx } from 'src/common/interfaces/req-ctx.interface';

const REUSE_GRACE_MS = 10_000; // see rotateRefresh()

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokens: Repository<RefreshToken>,
    private readonly passwords: PasswordService,
    private readonly otps: OtpService,
    private readonly tokens: TokenService,
    private readonly events: EventEmitter2,
    private readonly dataSource: DataSource,
  ) {}

  // ── S1-01 ────────────────────────────────────────────────────────────────
  async register(dto: RegisterDto, ctx: ReqCtx) {
    const email = dto.email.toLowerCase().trim();

    const existing = await this.users.findOne({ where: { email } });
    if (existing) throw Problems.emailAlreadyRegistered();

    const user = await this.users.save(
      this.users.create({
        email,
        passwordHash: await this.passwords.hash(dto.password),
      }),
    );

    const code = await this.otps.issueOtp(user.id);

    // `this.events` is Nest's EventEmitter2 (injected in the constructor above).
    // Emitting does NOT send the email — it just fans out to @OnEvent handlers.
    // The handler that turns this into an email + an audit row is AuthListener (§10);
    // the module wiring that connects the two is in §11.5.
    // Why an event instead of calling the email service directly: registration must not
    // fail because Resend is down, and AuthService must not know that audit logs exist.
    // Same reasoning extends to referralCode (Sprint 13): AuthService must not know
    // referrals exist either — CreditsListener grants the signup bonus and
    // ReferralsListener records the referral, both off this one event, both wrapped
    // so neither can fail registration itself.
    this.events.emit('user.registered', {
      user,
      code,
      ctx,
      referralCode: dto.referralCode,
    });
    return user; // controller maps to UserResponse
  }

  // ── S1-02 ────────────────────────────────────────────────────────────────
  async verifyEmail(dto: VerifyOtpDto, ctx: ReqCtx) {
    const user = await this.users.findOne({
      where: { email: dto.email.toLowerCase() },
    });
    if (!user) throw Problems.otpExpired(); // same shape as a bad code — no enumeration
    if (user.isVerified) return this.issueSession(user, ctx); // idempotent: double-submit is fine

    await this.otps.consumeOtp(user.id, dto.code);

    user.isVerified = true;
    await this.users.save(user);

    this.events.emit('user.verified', { user, ctx });
    return this.issueSession(user, ctx); // verifying logs you straight in — one less step
  }

  async resendOtp(email: string) {
    const user = await this.users.findOne({
      where: { email: email.toLowerCase() },
    });
    if (!user || user.isVerified) return; // silent no-op — never confirm an email exists
    const code = await this.otps.issueOtp(user.id); // throws otpCooldown if too soon
    this.events.emit('otp.resend', { user, code });
  }

  // ── S1-03 ────────────────────────────────────────────────────────────────
  async login(dto: LoginDto, ctx: ReqCtx) {
    const user = await this.users.findOne({
      where: { email: dto.email.toLowerCase() },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        role: true, // ← passwordHash is
        status: true,
        isVerified: true,
        tokenVersion: true,
      }, //   select:false; ask for it
    });

    if (!user) {
      await this.passwords.fakeVerify(); // constant-time-ish: see PasswordService
      this.events.emit('login.failed', {
        email: dto.email,
        ctx,
        reason: 'no_user',
      });
      throw Problems.invalidCredentials();
    }
    if (!(await this.passwords.verify(user.passwordHash, dto.password))) {
      this.events.emit('login.failed', {
        email: dto.email,
        ctx,
        reason: 'bad_password',
      });
      throw Problems.invalidCredentials(); // identical problem, identical status
    }
    if (user.status === 'suspended') throw Problems.accountSuspended();

    // Unverified users CAN log in (so the UI can show the OTP screen with a session),
    // but VerifiedGuard blocks upload/analyze. Blocking login instead traps users who
    // lost the email with no way back in.
    await this.users.update(user.id, { lastLoginAt: new Date() });
    this.events.emit('login.success', { user, ctx });
    return this.issueSession(user, ctx);
  }

  // ── S1-04 · the interesting one ──────────────────────────────────────────
  async rotateRefresh(rawToken: string, ctx: ReqCtx) {
    const [id, secret] = rawToken.split('.');
    if (!id || !secret) throw Problems.refreshInvalid();

    return this.dataSource.transaction(async (m) => {
      // Lock the row. Two concurrent refreshes now serialize here instead of both
      // reading "valid" and both rotating (which would fork the family).
      const token = await m.findOne(RefreshToken, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!token) throw Problems.refreshInvalid();

      // Constant-time compare: a plain === leaks the hash byte-by-byte via timing.
      const presented = createHash('sha256').update(secret).digest();
      const stored = Buffer.from(token.tokenHash, 'hex');
      if (
        presented.length !== stored.length ||
        !timingSafeEqual(presented, stored)
      ) {
        throw Problems.refreshInvalid();
      }

      if (token.expiresAt < new Date()) throw Problems.refreshInvalid();

      // ── REUSE ─────────────────────────────────────────────────────────────
      if (token.revokedAt) {
        const age = Date.now() - token.revokedAt.getTime();

        // A RACE, not theft: this exact token was rotated moments ago (StrictMode,
        // two tabs, a retried request). The legitimate client already holds the new
        // token. Fail softly — do NOT destroy the session.
        if (
          token.revokedReason === 'rotated' &&
          token.replacedById &&
          age < REUSE_GRACE_MS
        ) {
          throw Problems.refreshSuperseded(); // client retries with its current token
        }

        // Real reuse: a token that was rotated long ago is being replayed.
        // Only an attacker holding a stale copy does this. Burn the family.
        await this.tokens.revokeFamily(token.familyId, 'reuse_detected', m);
        this.events.emit('token.reuse_detected', {
          userId: token.userId,
          familyId: token.familyId,
          ctx,
        });
        throw Problems.refreshInvalid();
      }

      const user = await m.findOne(User, { where: { id: token.userId } });
      if (!user || user.status !== 'active') throw Problems.refreshInvalid();

      // Rotate: mint the successor inside the same family, then revoke the parent.
      const next = await this.tokens.issueRefresh(
        user.id,
        ctx,
        token.familyId,
        m,
      );
      token.revokedAt = new Date();
      token.revokedReason = 'rotated';
      token.replacedById = next.entity.id;
      await m.save(token);

      return {
        accessToken: await this.tokens.signAccess(user),
        refreshToken: next.raw,
        user,
      };
    });
  }

  async logout(rawToken: string) {
    const [id] = rawToken.split('.');
    const token = await this.refreshTokens.findOne({ where: { id } });
    if (!token) return; // already gone — idempotent
    // Revoke the FAMILY, not just this token: otherwise the successor token
    // (already in the client's hands, or an attacker's) still works after "logout".
    await this.tokens.revokeFamily(token.familyId, 'logout');
  }

  // ── S1-05 ────────────────────────────────────────────────────────────────
  async forgotPassword(email: string, ctx: ReqCtx) {
    const user = await this.users.findOne({
      where: { email: email.toLowerCase() },
    });
    // ALWAYS returns void → controller always 200/204. Existence is never revealed.
    if (!user) return;
    const raw = await this.otps.issueResetToken(user.id);
    this.events.emit('password.reset_requested', { user, token: raw, ctx });
  }

  async resetPassword(dto: ResetPasswordDto, ctx: ReqCtx) {
    const userId = await this.otps.consumeResetToken(dto.token); // single-use, 30 min

    await this.dataSource.transaction(async (m) => {
      await m.update(User, userId, {
        passwordHash: await this.passwords.hash(dto.password),
        tokenVersion: () => 'token_version + 1', // ← kills every live ACCESS token instantly
      });
      await m.update(
        RefreshToken,
        { userId, revokedAt: IsNull() },
        { revokedAt: new Date(), revokedReason: 'password_reset' },
      ); // and every session
    });

    this.events.emit('password.reset', { userId, ctx });
  }

  // ── shared ───────────────────────────────────────────────────────────────
  private async issueSession(user: User, ctx: ReqCtx) {
    const { raw } = await this.tokens.issueRefresh(user.id, ctx); // new family = new device
    return {
      accessToken: await this.tokens.signAccess(user),
      refreshToken: raw,
      user,
    };
  }

  async listSessions(userId: string) {
    return this.refreshTokens.find({
      where: { userId, revokedAt: IsNull() },
      order: { createdAt: 'DESC' },
    }); // one row per active family generation — group by familyId in the response DTO
  }

  async revokeSession(userId: string, familyId: string) {
    const owns = await this.refreshTokens.findOne({
      where: { userId, familyId },
    });
    if (!owns) throw new NotFoundException();
    await this.tokens.revokeFamily(familyId, 'logout');
  }
}
