import { RateLimitError } from 'openai/error';
import { AiService } from './ai.service';
import { PromptTemplate } from '../prompts/entities/prompt-template.entity';

// AiService constructs its own OpenAI client internally (it's a thin wrapper around a
// stable external SDK, not something worth threading a factory through DI for). Tests
// reach past that by overriding the private `client` field after construction — the
// SDK boundary itself is exercised for real in the live end-to-end run, not here.
function buildService(overrides: { parse: jest.Mock }) {
  const envValues: Record<string, unknown> = {
    OPENAI_API_KEY: 'sk-test',
    OPENAI_TIMEOUT_MS: 1000,
    OPENAI_MAX_RETRIES: 0,
    OPENAI_CONCURRENCY: 5,
  };
  const env = { get: (k: string) => envValues[k] } as any;

  const template: PromptTemplate = {
    key: 'resume_extraction',
    version: 1,
    model: 'gpt-4o-mini',
    temperature: '0.10',
    maxTokens: 4096,
    schemaKey: 'resume_extraction',
    systemTemplate: 'sys {{resume_text}}',
    userTemplate: 'usr {{resume_text}}',
    variables: ['resume_text'],
    isActive: true,
  } as PromptTemplate;

  const prompts = {
    getActive: jest.fn().mockResolvedValue(template),
    render: jest.fn().mockReturnValue({ system: 'sys', user: 'usr' }),
  } as any;
  const pricing = {
    computeCostUsd: jest.fn().mockReturnValue('0.000100'),
  } as any;
  const budget = {
    assertWithinBudget: jest.fn().mockResolvedValue(undefined),
    recordUsage: jest.fn().mockResolvedValue(undefined),
  } as any;

  const service = new AiService(env, prompts, pricing, budget);
  (service as any).client = {
    chat: { completions: { parse: overrides.parse } },
  };
  // Skip the real onModuleInit(): it dynamically imports the ESM-only p-limit package,
  // which Node handles fine at runtime (verified live) but ts-jest's CommonJS transform
  // can't load under test. A pass-through limiter is exactly equivalent for these tests,
  // which are about complete()'s retry/taxonomy logic, not p-limit's module loading.
  (service as any).limit = (fn: () => unknown) => fn();
  return { service, budget, prompts };
}

function usage() {
  return {
    prompt_tokens: 100,
    completion_tokens: 50,
    prompt_tokens_details: { cached_tokens: 0 },
  };
}

describe('AiService.complete', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns parsed data and usage on a clean success', async () => {
    const parse = jest.fn().mockResolvedValue({
      choices: [{ message: { parsed: { hello: 'world' }, refusal: null } }],
      usage: usage(),
    });
    const { service, budget } = buildService({ parse });

    const result = await service.complete<{ hello: string }>({
      feature: 'resume_extraction',
      promptKey: 'resume_extraction',
      variables: { resume_text: 'x' },
    });

    expect(result.data).toEqual({ hello: 'world' });
    expect(result.usage.attempts).toBe(1);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(budget.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, attempts: 1 }),
    );
  });

  it('retries exactly once on invalid_output (null parsed) and succeeds on the repair attempt', async () => {
    const parse = jest
      .fn()
      .mockResolvedValueOnce({
        choices: [{ message: { parsed: null, refusal: null } }],
        usage: usage(),
      })
      .mockResolvedValueOnce({
        choices: [{ message: { parsed: { hello: 'world' }, refusal: null } }],
        usage: usage(),
      });
    const { service } = buildService({ parse });

    const result = await service.complete({
      feature: 'resume_extraction',
      promptKey: 'resume_extraction',
      variables: { resume_text: 'x' },
    });

    expect(parse).toHaveBeenCalledTimes(2);
    expect(result.usage.attempts).toBe(2);
  });

  it('fails after the repair retry is also invalid, throwing AI_OUTPUT_INVALID', async () => {
    const parse = jest.fn().mockResolvedValue({
      choices: [{ message: { parsed: null, refusal: null } }],
      usage: usage(),
    });
    const { service } = buildService({ parse });

    await expect(
      service.complete({
        feature: 'resume_extraction',
        promptKey: 'resume_extraction',
        variables: { resume_text: 'x' },
      }),
    ).rejects.toMatchObject({ code: 'AI_OUTPUT_INVALID' });
    expect(parse).toHaveBeenCalledTimes(2); // exactly one repair attempt, not more
  });

  it('does NOT retry a provider-level error (rate_limited) — fails immediately as AI_PROVIDER_UNAVAILABLE', async () => {
    const parse = jest
      .fn()
      .mockRejectedValue(
        new RateLimitError(
          429,
          { message: 'slow down' },
          'Rate limited',
          new Headers(),
        ),
      );
    const { service } = buildService({ parse });

    await expect(
      service.complete({
        feature: 'resume_extraction',
        promptKey: 'resume_extraction',
        variables: { resume_text: 'x' },
      }),
    ).rejects.toMatchObject({ code: 'AI_PROVIDER_UNAVAILABLE' });
    expect(parse).toHaveBeenCalledTimes(1); // no app-level retry — the SDK already retried internally
  });

  it('treats a refusal as content_filtered, even without an SDK-thrown error', async () => {
    const parse = jest.fn().mockResolvedValue({
      choices: [
        { message: { parsed: null, refusal: 'I cannot help with that.' } },
      ],
      usage: usage(),
    });
    const { service } = buildService({ parse });

    await expect(
      service.complete({
        feature: 'resume_extraction',
        promptKey: 'resume_extraction',
        variables: { resume_text: 'x' },
      }),
    ).rejects.toMatchObject({ code: 'AI_CONTENT_FILTERED' });
    expect(parse).toHaveBeenCalledTimes(1); // not retryable
  });

  it('checks the budget before ever calling the model', async () => {
    const parse = jest.fn();
    const { service, budget } = buildService({ parse });
    budget.assertWithinBudget.mockRejectedValueOnce({
      code: 'AI_BUDGET_EXCEEDED',
    });

    await expect(
      service.complete({
        feature: 'resume_extraction',
        promptKey: 'resume_extraction',
        variables: { resume_text: 'x' },
      }),
    ).rejects.toMatchObject({ code: 'AI_BUDGET_EXCEEDED' });
    expect(parse).not.toHaveBeenCalled();
  });
});
