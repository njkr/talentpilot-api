import { Injectable } from '@nestjs/common';
import { IsNull, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { VerificationToken } from '../entities/verification-token.entity';
import { Env } from 'src/config/config.module';
import { createHash, randomBytes, randomInt } from 'crypto';
import { Problems } from 'src/common/problems';
import * as argon2 from 'argon2';

@Injectable()
export class OtpService {
  constructor(
    @InjectRepository(VerificationToken)
    private readonly repo: Repository<VerificationToken>,
    private readonly env: Env,
  ) {}

  /** 6-digit, cryptographically random. Math.random() is predictable — never use it here. */
  private generateOtp(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
  }

  /** High-entropy (256-bit) → sha256 is fine; brute force is infeasible regardless of speed. */
  private sha256(s: string) {
    return createHash('sha256').update(s).digest('hex');
  }

  async issueOtp(userId: string) {
    // Cooldown: look at the newest un-consumed OTP for this user.
    const last = await this.repo.findOne({
      where: { userId, type: 'email_otp' },
      order: { createdAt: 'DESC' },
    });
    if (last) {
      const elapsed = (Date.now() - last.createdAt.getTime()) / 1000;
      const cooldown = this.env.get('OTP_RESEND_COOLDOWN_SEC');
      if (elapsed < cooldown)
        throw Problems.otpCooldown(Math.ceil(cooldown - elapsed));
    }

    // Invalidate previous codes — only the newest may ever work.
    await this.repo.update(
      { userId, type: 'email_otp', consumedAt: IsNull() },
      { consumedAt: new Date() },
    );

    const code = this.generateOtp();
    await this.repo.save(
      this.repo.create({
        userId,
        type: 'email_otp',
        codeHash: await argon2.hash(code), // argon2 (not sha256): only 10^6 possible codes,
        // so a leaked DB + fast hash = instantly cracked.
        expiresAt: new Date(Date.now() + this.env.get('OTP_TTL_MIN') * 60_000),
      }),
    );
    return code; // returned once, to be emailed. Never stored, never logged.
  }

  async consumeOtp(userId: string, code: string) {
    const token = await this.repo.findOne({
      where: { userId, type: 'email_otp', consumedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
    if (!token) throw Problems.otpExpired();
    if (token.expiresAt < new Date()) throw Problems.otpExpired();
    if (token.attempts >= this.env.get('OTP_MAX_ATTEMPTS'))
      throw Problems.otpMaxAttempts();

    if (!(await argon2.verify(token.codeHash, code))) {
      // Increment atomically — two parallel guesses must both count.
      await this.repo.increment({ id: token.id }, 'attempts', 1);
      const remaining = this.env.get('OTP_MAX_ATTEMPTS') - (token.attempts + 1);
      if (remaining <= 0) throw Problems.otpMaxAttempts();
      throw Problems.otpInvalid(remaining);
    }

    token.consumedAt = new Date(); // single use, enforced here
    await this.repo.save(token);
  }

  // ---- password reset: 256-bit opaque token, sha256, single-use ----
  async issueResetToken(userId: string) {
    await this.repo.update(
      { userId, type: 'password_reset', consumedAt: IsNull() },
      { consumedAt: new Date() },
    );
    const raw = randomBytes(32).toString('base64url');
    await this.repo.save(
      this.repo.create({
        userId,
        type: 'password_reset',
        codeHash: this.sha256(raw),
        expiresAt: new Date(
          Date.now() + this.env.get('RESET_TTL_MIN') * 60_000,
        ),
      }),
    );
    return raw;
  }

  async consumeResetToken(raw: string): Promise<string> {
    const token = await this.repo.findOne({
      where: {
        type: 'password_reset',
        codeHash: this.sha256(raw),
        consumedAt: IsNull(),
      },
    });
    if (!token || token.expiresAt < new Date())
      throw Problems.resetTokenInvalid();
    token.consumedAt = new Date();
    await this.repo.save(token);
    return token.userId;
  }
}
