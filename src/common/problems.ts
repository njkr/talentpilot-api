import { HttpException } from '@nestjs/common';

const BASE = 'https://talentpilot.app/errors';

export class Problem extends HttpException {
  constructor(
    type: string,
    title: string,
    status: number,
    detail?: string,
    ext: Record<string, unknown> = {},
  ) {
    super({ type: `${BASE}/${type}`, title, status, detail, ...ext }, status);
  }
}

export const Problems = {
  // Deliberately identical for "no such user" and "wrong password". If they differ in
  // ANY way — code, message, status, or timing — you have a user-enumeration oracle.
  invalidCredentials: () =>
    new Problem(
      'invalid-credentials',
      'Invalid credentials',
      401,
      'Email or password is incorrect.',
    ),

  emailAlreadyRegistered: () =>
    new Problem(
      'email-already-registered',
      'Email already registered',
      409,
      'An account with this email already exists.',
    ),

  emailNotVerified: () =>
    new Problem(
      'email-not-verified',
      'Email not verified',
      403,
      'Verify your email address to continue.',
    ),

  accountSuspended: () =>
    new Problem('account-suspended', 'Account suspended', 403),

  otpInvalid: (remaining: number) =>
    new Problem(
      'otp-invalid',
      'Incorrect code',
      400,
      `That code is incorrect. ${remaining} attempt(s) remaining.`,
      { remaining },
    ),

  otpExpired: () =>
    new Problem(
      'otp-expired',
      'Code expired',
      400,
      'That code has expired. Request a new one.',
    ),

  otpMaxAttempts: () =>
    new Problem(
      'otp-max-attempts',
      'Too many attempts',
      429,
      'Too many incorrect codes. Request a new one.',
    ),

  otpCooldown: (retryAfterSec: number) =>
    new Problem(
      'otp-cooldown',
      'Please wait',
      429,
      `Wait ${retryAfterSec}s before requesting another code.`,
      { retryAfterSec },
    ),

  refreshInvalid: () =>
    new Problem(
      'refresh-invalid',
      'Session invalid',
      401,
      'Your session is no longer valid. Please sign in again.',
    ),

  // The soft-fail for a refresh race (see §6). NOT a security event.
  refreshSuperseded: () =>
    new Problem(
      'refresh-superseded',
      'Token superseded',
      401,
      'This token was just rotated. Retry with the current one.',
    ),

  resetTokenInvalid: () =>
    new Problem(
      'reset-token-invalid',
      'Reset link invalid',
      400,
      'This reset link is invalid or has expired.',
    ),
};
