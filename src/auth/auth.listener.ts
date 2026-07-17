import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Env } from 'src/config/config.module';
import { AuditLog } from 'src/audit/entities/audit-log.entity';
import { ReqCtx } from 'src/common/interfaces/req-ctx.interface';

@Injectable()
export class AuthListener {
  private readonly logger = new Logger(AuthListener.name);

  constructor(
    @InjectQueue('emails') private readonly emails: Queue,
    @InjectRepository(AuditLog) private readonly audit: Repository<AuditLog>,
    private readonly env: Env,
  ) {}

  @OnEvent('user.registered')
  async onRegistered({ user, code, ctx }: any) {
    await this.emails.add('send', {
      to: user.email,
      template: 'verify-email',
      vars: { code, ttlMin: this.env.get('OTP_TTL_MIN') },
    });
    await this.log(user.id, 'user.registered', ctx);
  }

  // Without this handler, resendOtp() mints a fresh code and nobody ever emails it —
  // the user is stuck staring at an OTP screen that will never receive a code.
  @OnEvent('otp.resend')
  async onOtpResend({ user, code }: any) {
    await this.emails.add('send', {
      to: user.email,
      template: 'verify-email',
      vars: { code, ttlMin: this.env.get('OTP_TTL_MIN') },
    });
  }

  @OnEvent('password.reset_requested')
  async onResetRequested({ user, token, ctx }: any) {
    await this.emails.add('send', {
      to: user.email,
      template: 'reset-password',
      vars: { url: `${this.env.get('APP_URL')}/reset-password?token=${token}` },
    });
    await this.log(user.id, 'password.reset_requested', ctx);
  }

  // S1-07 — every auth event lands in audit_logs with ip + ua
  @OnEvent('login.success') onLoginOk(e: any) {
    return this.log(e.user.id, 'login.success', e.ctx);
  }
  @OnEvent('login.failed') onLoginBad(e: any) {
    return this.log(null, 'login.failed', e.ctx, {
      email: e.email,
      reason: e.reason,
    });
  }
  @OnEvent('user.verified') onVerified(e: any) {
    return this.log(e.user.id, 'email.verified', e.ctx);
  }
  @OnEvent('password.reset') onReset(e: any) {
    return this.log(e.userId, 'password.reset', e.ctx);
  }
  @OnEvent('token.reuse_detected') onReuse(e: any) {
    return this.log(e.userId, 'token.reuse_detected', e.ctx, {
      familyId: e.familyId,
    });
  }

  private async log(
    userId: string | null,
    action: string,
    ctx: ReqCtx | undefined,
    meta: Record<string, unknown> = {},
  ) {
    try {
      await this.audit.save(
        this.audit.create({
          userId,
          actorType: 'user',
          action,
          resourceType: 'auth',
          ip: ctx?.ip ?? null,
          userAgent: ctx?.userAgent ?? null,
          metadata: meta,
        }),
      );
    } catch (e) {
      // Audit must NEVER break the user's action. Log and move on.
      this.logger.error(`audit write failed for ${action}`, e as Error);
    }
  }
}
