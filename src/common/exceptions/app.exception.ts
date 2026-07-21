import { HttpException } from '@nestjs/common';

export interface ApiMeta {
  requestId: string;
  timestamp: string; // ISO
  nextCursor?: string | null; // list endpoints only
  hasMore?: boolean;
  total?: number; // only when cheap to compute
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta: ApiMeta;
}
export interface ApiFailure {
  success: false;
  error: ApiErrorBody;
  meta: ApiMeta;
}
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface ApiErrorBody {
  code: ErrorCode;
  message: string; // human-readable, safe to display
  details?: Record<string, unknown>; // machine-usable context
  fields?: Record<string, string[]>; // validation errors, keyed by field
}

export const ErrorCode = {
  // auth (401 / 403)
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED', // → silently refresh
  TOKEN_INVALID: 'TOKEN_INVALID', // → hard logout
  TOKEN_SUPERSEDED: 'TOKEN_SUPERSEDED', // → soft: retry with the current token, not a logout
  TOKEN_REUSE_DETECTED: 'TOKEN_REUSE_DETECTED', // → hard logout + warn
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED', // → route to OTP screen
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  OTP_INVALID: 'OTP_INVALID',
  OTP_EXPIRED: 'OTP_EXPIRED',
  OTP_MAX_ATTEMPTS: 'OTP_MAX_ATTEMPTS',
  OTP_COOLDOWN: 'OTP_COOLDOWN', // details: { retryAfterSec }
  RESET_TOKEN_INVALID: 'RESET_TOKEN_INVALID',

  // validation / resources
  VALIDATION_FAILED: 'VALIDATION_FAILED', // fields: {...}
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',

  // files
  FILE_TOO_LARGE: 'FILE_TOO_LARGE', // details: { maxMb }
  FILE_TYPE_UNSUPPORTED: 'FILE_TYPE_UNSUPPORTED',
  FILE_TOO_MANY_PAGES: 'FILE_TOO_MANY_PAGES',
  FILE_UNREADABLE: 'FILE_UNREADABLE', // scanned/image PDF
  FILE_CORRUPT: 'FILE_CORRUPT', // truncated/damaged, not just an unsupported type
  RESUME_NOT_PARSED: 'RESUME_NOT_PARSED', // resume isn't in a usable state yet (also reused for "still processing")
  RESUME_IN_USE: 'RESUME_IN_USE', // details: { workspaces }

  // billing / plan
  INSUFFICIENT_CREDITS: 'INSUFFICIENT_CREDITS', // details: { required, balance }
  PLAN_LIMIT_REACHED: 'PLAN_LIMIT_REACHED', // details: { limit, current, feature }
  PAYMENT_FAILED: 'PAYMENT_FAILED',

  // pipeline
  ANALYSIS_ALREADY_RUNNING: 'ANALYSIS_ALREADY_RUNNING', // details: { runId }
  IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',
  RUN_NOT_RETRYABLE: 'RUN_NOT_RETRYABLE',
  AI_PROVIDER_UNAVAILABLE: 'AI_PROVIDER_UNAVAILABLE',
  AI_BUDGET_EXCEEDED: 'AI_BUDGET_EXCEEDED',
  AI_OUTPUT_INVALID: 'AI_OUTPUT_INVALID', // model output failed schema validation twice
  AI_CONTEXT_TOO_LONG: 'AI_CONTEXT_TOO_LONG', // input exceeds the model's context window
  AI_CONTENT_FILTERED: 'AI_CONTENT_FILTERED', // provider refused the content

  // job descriptions / matching
  JD_TOO_SHORT: 'JD_TOO_SHORT', // pasted/uploaded text too short to be a real JD
  JD_NOT_ANALYZED: 'JD_NOT_ANALYZED', // JD analysis hasn't finished (or failed) yet

  // platform
  RATE_LIMITED: 'RATE_LIMITED', // details: { retryAfterSec }
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

const STATUS: Record<string, number> = {
  INVALID_CREDENTIALS: 401,
  TOKEN_EXPIRED: 401,
  TOKEN_INVALID: 401,
  TOKEN_SUPERSEDED: 401,
  TOKEN_REUSE_DETECTED: 401,
  OTP_INVALID: 400,
  OTP_EXPIRED: 400,
  OTP_MAX_ATTEMPTS: 429,
  OTP_COOLDOWN: 429,
  RESET_TOKEN_INVALID: 400,
  EMAIL_NOT_VERIFIED: 403,
  ACCOUNT_SUSPENDED: 403,
  PLAN_LIMIT_REACHED: 403,
  VALIDATION_FAILED: 400,
  NOT_FOUND: 404,
  ALREADY_EXISTS: 409,
  FILE_TOO_LARGE: 413,
  FILE_TYPE_UNSUPPORTED: 422,
  FILE_TOO_MANY_PAGES: 422,
  FILE_UNREADABLE: 422,
  FILE_CORRUPT: 422,
  RESUME_NOT_PARSED: 409,
  RESUME_IN_USE: 409,
  INSUFFICIENT_CREDITS: 402,
  PAYMENT_FAILED: 402,
  ANALYSIS_ALREADY_RUNNING: 409,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  RUN_NOT_RETRYABLE: 409,
  AI_PROVIDER_UNAVAILABLE: 503,
  AI_BUDGET_EXCEEDED: 429,
  AI_OUTPUT_INVALID: 502,
  AI_CONTEXT_TOO_LONG: 422,
  AI_CONTENT_FILTERED: 422,
  JD_TOO_SHORT: 422,
  JD_NOT_ANALYZED: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export class AppException extends HttpException {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super({ code, message, details }, STATUS[code] ?? 400);
  }
}
