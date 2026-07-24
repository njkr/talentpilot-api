import { TokenExpiredError } from 'jsonwebtoken';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AppException, ErrorCode } from '../../common/exceptions/app.exception';

function build() {
  const reflector = { getAllAndOverride: jest.fn() };
  const guard = new JwtAuthGuard(reflector as any);
  return { guard, reflector };
}

describe('JwtAuthGuard.handleRequest', () => {
  it('throws TOKEN_EXPIRED when info is a TokenExpiredError — not the generic 401 every other failure gets', () => {
    const { guard } = build();
    const expired = new TokenExpiredError('jwt expired', new Date());

    let error: any;
    try {
      guard.handleRequest(null, false, expired);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(AppException);
    expect(error.code).toBe(ErrorCode.TOKEN_EXPIRED);
  });

  it('propagates a real error thrown from JwtStrategy.validate() (e.g. stale tokenVersion) unchanged', () => {
    const { guard } = build();
    const original = new AppException(
      ErrorCode.TOKEN_INVALID,
      'Your session is no longer valid. Please sign in again.',
    );

    let error: any;
    try {
      guard.handleRequest(original, false, undefined);
    } catch (e) {
      error = e;
    }

    expect(error).toBe(original); // same instance — not re-wrapped
    expect(error.code).toBe(ErrorCode.TOKEN_INVALID);
  });

  it('falls back to TOKEN_INVALID for a malformed/no-info failure (not TOKEN_EXPIRED, not a bare UnauthorizedException)', () => {
    const { guard } = build();

    let error: any;
    try {
      guard.handleRequest(null, false, undefined);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(AppException);
    expect(error.code).toBe(ErrorCode.TOKEN_INVALID);
  });

  it('returns the user on success', () => {
    const { guard } = build();
    const user = { id: 'user-1' };
    expect(guard.handleRequest(null, user, undefined)).toBe(user);
  });
});
