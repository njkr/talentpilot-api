import { ForbiddenException } from '@nestjs/common';
import { AdminGuard } from './admin.guard';

function ctx(user: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
}

function build(allowedEmails: string) {
  const env = { get: jest.fn().mockReturnValue(allowedEmails) };
  return { guard: new AdminGuard(env as any), env };
}

describe('AdminGuard', () => {
  it('allows a role=admin user whose email is on the allowlist', () => {
    const { guard } = build('ops@talentpilot.com, other@x.com');
    expect(
      guard.canActivate(ctx({ role: 'admin', email: 'ops@talentpilot.com' })),
    ).toBe(true);
  });

  it('is case-insensitive when matching the allowlist', () => {
    const { guard } = build('ops@talentpilot.com');
    expect(
      guard.canActivate(ctx({ role: 'admin', email: 'OPS@TalentPilot.com' })),
    ).toBe(true);
  });

  it('rejects role=admin if the email is NOT on the allowlist — role alone is not enough', () => {
    const { guard } = build('ops@talentpilot.com');
    expect(() =>
      guard.canActivate(ctx({ role: 'admin', email: 'attacker@evil.com' })),
    ).toThrow(ForbiddenException);
  });

  it('rejects an allowlisted email if role is NOT admin — allowlist alone is not enough', () => {
    const { guard } = build('user@talentpilot.com');
    expect(() =>
      guard.canActivate(ctx({ role: 'user', email: 'user@talentpilot.com' })),
    ).toThrow(ForbiddenException);
  });

  it('rejects when there is no user on the request', () => {
    const { guard } = build('ops@talentpilot.com');
    expect(() => guard.canActivate(ctx(undefined))).toThrow(ForbiddenException);
  });

  it('rejects when the allowlist is empty', () => {
    const { guard } = build('');
    expect(() =>
      guard.canActivate(ctx({ role: 'admin', email: 'ops@talentpilot.com' })),
    ).toThrow(ForbiddenException);
  });
});
