import {
  APIConnectionTimeoutError,
  BadRequestError,
  ContentFilterFinishReasonError,
  InternalServerError,
  LengthFinishReasonError,
  RateLimitError,
} from 'openai/error';
import { AiError } from './ai.errors';

describe('AiError.fromOpenAI', () => {
  it('classifies RateLimitError as rate_limited and reads Retry-After from the Headers object', () => {
    const headers = new Headers({ 'retry-after': '5' });
    const err = new RateLimitError(
      429,
      { message: 'slow down' },
      'Rate limited',
      headers,
    );

    const aiErr = AiError.fromOpenAI(err);

    expect(aiErr.type).toBe('rate_limited');
    expect(aiErr.retryable).toBe(true);
    expect(aiErr.retryAfterMs).toBe(5000);
  });

  it('classifies a timeout as provider_down', () => {
    const aiErr = AiError.fromOpenAI(new APIConnectionTimeoutError());
    expect(aiErr.type).toBe('provider_down');
    expect(aiErr.retryable).toBe(true);
  });

  it('classifies a 5xx InternalServerError as provider_down', () => {
    const err = new InternalServerError(
      500,
      { message: 'oops' },
      'Server error',
      new Headers(),
    );
    const aiErr = AiError.fromOpenAI(err);
    expect(aiErr.type).toBe('provider_down');
    expect(aiErr.retryable).toBe(true);
  });

  it('classifies LengthFinishReasonError as invalid_output and retryable (one repair attempt)', () => {
    const aiErr = AiError.fromOpenAI(new LengthFinishReasonError());
    expect(aiErr.type).toBe('invalid_output');
    expect(aiErr.retryable).toBe(true);
  });

  it('classifies ContentFilterFinishReasonError as content_filtered and not retryable', () => {
    const aiErr = AiError.fromOpenAI(new ContentFilterFinishReasonError());
    expect(aiErr.type).toBe('content_filtered');
    expect(aiErr.retryable).toBe(false);
  });

  it('classifies a 400 "context length" message as context_too_long and not retryable', () => {
    const err = new BadRequestError(
      400,
      { message: "This model's maximum context length is 128000 tokens." },
      undefined,
      new Headers(),
    );
    const aiErr = AiError.fromOpenAI(err);
    expect(aiErr.type).toBe('context_too_long');
    expect(aiErr.retryable).toBe(false);
  });

  it('classifies an unrecognized error as unknown and not retryable', () => {
    const aiErr = AiError.fromOpenAI(new Error('something weird'));
    expect(aiErr.type).toBe('unknown');
    expect(aiErr.retryable).toBe(false);
  });
});
