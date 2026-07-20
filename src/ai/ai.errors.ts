import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIUserAbortError,
  ContentFilterFinishReasonError,
  LengthFinishReasonError,
  RateLimitError,
  // These two are NOT re-exported from the top-level 'openai' package (only from
  // 'openai/error') — thrown by chat.completions.parse() when finish_reason is
  // 'length' or 'content_filter', i.e. the model responded but not usefully.
} from 'openai/error';

/**
 * The orchestrator (a later sprint) decides retry-vs-fail based on these types, so the
 * classification IS the contract. Getting it wrong means either burning money retrying
 * an unfixable error, or failing a run that would have succeeded on attempt two.
 */
export type AiErrorType =
  | 'rate_limited' // 429 — retryable, respect Retry-After
  | 'provider_down' // 5xx / network / timeout — retryable
  | 'invalid_output' // schema violation — ONE repair retry, then fail
  | 'context_too_long' // input exceeds the window — NOT retryable, truncate instead
  | 'budget_exceeded' // our own guard — NOT retryable
  | 'content_filtered' // provider refused — NOT retryable
  | 'unknown';

export class AiError extends Error {
  constructor(
    public readonly type: AiErrorType,
    message: string,
    public readonly retryable: boolean,
    public readonly retryAfterMs?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AiError';
  }

  /**
   * Classify an error thrown by the OpenAI SDK. Uses `instanceof` against the SDK's own
   * error classes rather than duck-typing `.name`/`.code` strings — those aren't a
   * documented part of the SDK's contract and drift silently across versions; the
   * exported error classes are.
   */
  static fromOpenAI(err: unknown): AiError {
    if (err instanceof RateLimitError) {
      // Respect the provider's own backoff hint when present — guessing is worse.
      // `headers` is a fetch-standard Headers object: bracket access silently returns
      // undefined on it, you must call .get().
      const hdr =
        err.headers?.get?.('retry-after') ??
        err.headers?.get?.('retry-after-ms');
      const ms = hdr
        ? Number(hdr) < 1000
          ? Number(hdr) * 1000
          : Number(hdr)
        : undefined;
      return new AiError(
        'rate_limited',
        'Rate limited by provider',
        true,
        ms,
        err,
      );
    }
    if (
      err instanceof APIConnectionTimeoutError ||
      err instanceof APIUserAbortError
    ) {
      return new AiError(
        'provider_down',
        'AI request timed out',
        true,
        undefined,
        err,
      );
    }
    if (err instanceof APIConnectionError) {
      return new AiError(
        'provider_down',
        'AI provider unavailable',
        true,
        undefined,
        err,
      );
    }
    if (err instanceof LengthFinishReasonError) {
      // The model was cut off by max_tokens before finishing valid JSON — not a
      // malformed response, just an incomplete one. One retry with a larger budget is
      // worth it; a second failure means the input itself needs trimming.
      return new AiError(
        'invalid_output',
        'AI response was truncated before completing valid output',
        true,
        undefined,
        err,
      );
    }
    if (err instanceof ContentFilterFinishReasonError) {
      return new AiError(
        'content_filtered',
        'Provider refused this content',
        false,
        undefined,
        err,
      );
    }

    const status = (err as { status?: number })?.status;
    const message = (err as { message?: string })?.message ?? '';

    if (typeof status === 'number' && status >= 500) {
      return new AiError(
        'provider_down',
        'AI provider unavailable',
        true,
        undefined,
        err,
      );
    }
    if (status === 400 && /context.*length|maximum context/i.test(message)) {
      return new AiError(
        'context_too_long',
        'Input exceeds model context window',
        false,
      );
    }
    if (status === 400 && /content.*filter|refus/i.test(message)) {
      return new AiError(
        'content_filtered',
        'Provider refused this content',
        false,
      );
    }
    return new AiError(
      'unknown',
      message || 'AI call failed',
      false,
      undefined,
      err,
    );
  }
}
