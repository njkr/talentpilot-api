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

  // A merely-expired ACCESS token — distinct from TOKEN_INVALID (malformed, bad
  // signature, stale user/tokenVersion): the frontend contract is "silently refresh"
  // for this one, not "hard logout" (see ErrorCode.TOKEN_EXPIRED's own comment).
  // Thrown from JwtAuthGuard.handleRequest() when Passport's `info` is a
  // TokenExpiredError, before it would otherwise fall through to a generic 401.
  tokenExpired: () =>
    new AppException(
      ErrorCode.TOKEN_EXPIRED,
      'Your access token has expired. Refresh it and retry.',
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

  // ── Sprint 5: pipeline & credits ────────────────────────────────────────────
  analysisAlreadyRunning: (runId: string) =>
    new AppException(
      ErrorCode.ANALYSIS_ALREADY_RUNNING,
      'This workspace already has an analysis running.',
      { runId },
    ),

  idempotencyKeyRequired: () =>
    new AppException(
      ErrorCode.IDEMPOTENCY_KEY_REQUIRED,
      'Send a unique Idempotency-Key header with this request.',
    ),

  insufficientCredits: (required: number, balance: number) =>
    new AppException(
      ErrorCode.INSUFFICIENT_CREDITS,
      `This analysis needs ${required} credits; you have ${balance}.`,
      { required, balance },
    ),

  runNotRetryable: (status: string) =>
    new AppException(ErrorCode.RUN_NOT_RETRYABLE, `This run is ${status}.`, {
      status,
    }),

  streamTicketInvalid: () =>
    new AppException(
      ErrorCode.STREAM_TICKET_INVALID,
      'This stream link is invalid or has expired. Request a new one.',
    ),

  reportNotReady: (status: string) =>
    new AppException(
      ErrorCode.REPORT_NOT_READY,
      `This workspace has no completed analysis yet (status: ${status}). Start or wait for a run to finish.`,
      { status },
    ),

  // ── Sprint 9: documents ────────────────────────────────────────────────────
  documentNotReady: (status: string) =>
    new AppException(
      ErrorCode.DOCUMENT_NOT_READY,
      status === 'failed'
        ? 'This document failed to generate. Request it again.'
        : `This document is still ${status}. Try again shortly.`,
      { status },
    ),

  // ── Sprint 13: configurable payments, credit packs & referrals ──────────────
  featureDisabled: (feature: string) =>
    new AppException(
      ErrorCode.FEATURE_DISABLED,
      `This feature is currently unavailable.`,
      { feature },
    ),

  // ── Sprint 14: cancellation & plan switching ─────────────────────────────────
  noActiveSubscription: () =>
    new AppException(
      ErrorCode.NO_ACTIVE_SUBSCRIPTION,
      'You have no active paid subscription.',
    ),

  noSubscriptionToResume: () =>
    new AppException(
      ErrorCode.NO_SUBSCRIPTION_TO_RESUME,
      'You have no subscription with a scheduled cancellation to resume.',
    ),

  planNotPurchasable: (planKey: string) =>
    new AppException(
      ErrorCode.PLAN_NOT_PURCHASABLE,
      `Plan "${planKey}" is not available for that billing interval.`,
      { planKey },
    ),

  alreadySubscribed: () =>
    new AppException(
      ErrorCode.ALREADY_SUBSCRIBED,
      'You already have an active subscription — use the switch-plan endpoint to change plans, not checkout.',
    ),

  // A genuine no-op switch (nothing pending to undo). Deliberately a real AppException,
  // not a plain BadRequestException — the global filter treats BadRequestException as a
  // class-validator error and mangles the message into a fake `fields` entry (splits on
  // the first word, so "You are already..." became `fields: { You: [...] }`). A
  // business-rule rejection belongs in `message`, not synthesized into `fields`.
  alreadyOnPlan: (planKey: string) =>
    new AppException(
      ErrorCode.ALREADY_SUBSCRIBED,
      `You're already on the "${planKey}" plan.`,
      { planKey },
    ),

  noPendingChange: () =>
    new AppException(
      ErrorCode.NO_SUBSCRIPTION_TO_RESUME,
      'There is no pending plan change to cancel.',
    ),

  // A Stripe call inside cancel/switch/clear-pending failed for a reason we don't map
  // to a more specific Problem — 502, not INTERNAL_ERROR, because the failure is
  // downstream (Stripe), not this request's fault.
  subscriptionUpdateFailed: () =>
    new AppException(
      ErrorCode.SUBSCRIPTION_UPDATE_FAILED,
      'We could not update your subscription. Please try again.',
    ),

  // ── Admin: user management ───────────────────────────────────────────────
  cannotModifyOwnAccess: () =>
    new AppException(
      ErrorCode.SELF_ACTION_FORBIDDEN,
      'You cannot revoke your own admin access.',
    ),

  // ── ATS rescoring ─────────────────────────────────────────────────────────
  noChangesToRescore: () =>
    new AppException(
      ErrorCode.NO_CHANGES_TO_RESCORE,
      'No changes since your last score — apply some suggestions first.',
    ),
};
