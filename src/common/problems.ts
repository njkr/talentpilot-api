import { AppException, ErrorCode } from './exceptions/app.exception';

// Auth-specific error catalogue, built on top of the shared AppException /
// ErrorCode envelope (see common/exceptions/app.exception.ts). Centralizing
// these here means every auth failure path throws a consistent, well-worded
// error instead of ad-hoc NestJS exceptions scattered through the service.
export const Problems = {
  // Deliberately identical for "no such user" and "wrong password". If they differ in
  // ANY way — code, message, status, or timing — you have a user-enumeration oracle.
  invalidCredentials: () =>
    new AppException(
      ErrorCode.INVALID_CREDENTIALS,
      'Email or password is incorrect.',
    ),

  emailAlreadyRegistered: () =>
    new AppException(
      ErrorCode.ALREADY_EXISTS,
      'An account with this email already exists.',
    ),

  emailNotVerified: () =>
    new AppException(
      ErrorCode.EMAIL_NOT_VERIFIED,
      'Verify your email address to continue.',
    ),

  accountSuspended: () =>
    new AppException(ErrorCode.ACCOUNT_SUSPENDED, 'This account is suspended.'),

  otpInvalid: (remaining: number) =>
    new AppException(
      ErrorCode.OTP_INVALID,
      `That code is incorrect. ${remaining} attempt(s) remaining.`,
      { remaining },
    ),

  otpExpired: () =>
    new AppException(
      ErrorCode.OTP_EXPIRED,
      'That code has expired. Request a new one.',
    ),

  otpMaxAttempts: () =>
    new AppException(
      ErrorCode.OTP_MAX_ATTEMPTS,
      'Too many incorrect codes. Request a new one.',
    ),

  otpCooldown: (retryAfterSec: number) =>
    new AppException(
      ErrorCode.OTP_COOLDOWN,
      `Wait ${retryAfterSec}s before requesting another code.`,
      { retryAfterSec },
    ),

  refreshInvalid: () =>
    new AppException(
      ErrorCode.TOKEN_INVALID,
      'Your session is no longer valid. Please sign in again.',
    ),

  // The soft-fail for a refresh race (see AuthService.rotateRefresh). NOT a security event.
  refreshSuperseded: () =>
    new AppException(
      ErrorCode.TOKEN_SUPERSEDED,
      'This token was just rotated. Retry with the current one.',
    ),

  resetTokenInvalid: () =>
    new AppException(
      ErrorCode.RESET_TOKEN_INVALID,
      'This reset link is invalid or has expired.',
    ),
};
