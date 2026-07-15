@Injectable()
export class AuthListener {
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
    ctx: ReqCtx,
    meta = {},
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
      Logger.error({ e, action }, 'audit write failed');
    }
  }
}
