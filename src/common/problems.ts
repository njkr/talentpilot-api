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

  // ── Sprint 2: resumes & storage ──────────────────────────────────────────
  fileTooLarge: (maxMb: number) =>
    new AppException(
      ErrorCode.FILE_TOO_LARGE,
      `Resumes must be under ${maxMb} MB.`,
      { maxMb },
    ),

  fileTypeUnsupported: (detected?: string) =>
    new AppException(
      ErrorCode.FILE_TYPE_UNSUPPORTED,
      'Upload a PDF or DOCX file.',
      {
        detected,
      },
    ),

  fileTooManyPages: (pages: number, max: number) =>
    new AppException(
      ErrorCode.FILE_TOO_MANY_PAGES,
      `This file has ${pages} pages; the maximum is ${max}.`,
      { pages, max },
    ),

  fileUnreadable: () =>
    new AppException(
      ErrorCode.FILE_UNREADABLE,
      'This looks like a scanned document or an image-only PDF. ' +
        'Please upload a text-based PDF or a DOCX file.',
    ),

  fileCorrupt: () =>
    new AppException(
      ErrorCode.FILE_CORRUPT,
      'This file appears to be damaged. Try re-exporting it and uploading again.',
    ),

  resumeNotReady: (status: string) =>
    new AppException(
      ErrorCode.RESUME_NOT_PARSED,
      `This resume is still being processed (status: ${status}).`,
      { status },
    ),

  resumeInUse: (workspaces: { id: string; name: string }[]) =>
    new AppException(
      ErrorCode.RESUME_IN_USE,
      `This resume is used by ${workspaces.length} workspace(s). Delete those first.`,
      { workspaces },
    ),

  planLimitReached: (feature: string, limit: number, current: number) =>
    new AppException(
      ErrorCode.PLAN_LIMIT_REACHED,
      `Your plan allows ${limit} ${feature}. Upgrade to add more.`,
      { feature, limit, current },
    ),

  // ── Sprint 3: AI gateway ──────────────────────────────────────────────────
  promptNotFound: (key: string) =>
    new AppException(
      ErrorCode.NOT_FOUND,
      `No active prompt template for "${key}".`,
      { key },
    ),

  aiProviderUnavailable: () =>
    new AppException(
      ErrorCode.AI_PROVIDER_UNAVAILABLE,
      'The AI provider is temporarily unavailable. Please try again shortly.',
    ),

  aiBudgetExceeded: (scope: 'user' | 'global') =>
    new AppException(
      ErrorCode.AI_BUDGET_EXCEEDED,
      scope === 'user'
        ? 'You have reached your daily AI usage limit. Try again tomorrow.'
        : 'The service has reached its daily AI usage limit. Try again tomorrow.',
      { scope },
    ),

  aiOutputInvalid: () =>
    new AppException(
      ErrorCode.AI_OUTPUT_INVALID,
      'The AI produced an invalid result and could not complete this request.',
    ),

  aiContextTooLong: () =>
    new AppException(
      ErrorCode.AI_CONTEXT_TOO_LONG,
      'This resume is too long to process.',
    ),

  aiContentFiltered: () =>
    new AppException(
      ErrorCode.AI_CONTENT_FILTERED,
      'This content was flagged by the AI provider and could not be processed.',
    ),

  // ── Sprint 4: job descriptions & matching ──────────────────────────────────
  jdTooShort: () =>
    new AppException(
      ErrorCode.JD_TOO_SHORT,
      'Paste the full job description — this looks incomplete.',
    ),

  jdNotReady: (status: string) =>
    new AppException(
      ErrorCode.JD_NOT_ANALYZED,
      `This job description is not ready to match against (status: ${status}).`,
      { status },
    ),
};
