import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OpenAI } from 'openai';
import type { LimitFunction } from 'p-limit';
import { Env } from '../config/config.module';
import { AppException, ErrorCode } from '../common/exceptions/app.exception';
import { Problems } from '../common/problems';
import { AiError } from './ai.errors';
import { PromptsService } from '../prompts/prompts.service';
import { PromptTemplate } from '../prompts/entities/prompt-template.entity';
import { PricingService } from './services/pricing.service';
import { TokenCounterService } from './services/token-counter.service';
import { BudgetService } from './services/budget.service';
import { getResponseFormat } from './schemas/registry';
import { DEFAULT_EMBEDDING_MODEL } from './model-catalog';

export interface AiCompleteOptions {
  feature: string;
  promptKey: string;
  variables: Record<string, string>;
  // If set and the rendered prompt won't fit the model's context window, this ONE
  // variable's value is truncated to make it fit — not the whole prompt. Callers pass
  // the name of whichever variable holds the large, truncatable body text (resume_text,
  // jd_text, ...); fixed instruction text in the template is never touched.
  truncateVariable?: string;
  userId?: string | null;
  workspaceId?: string | null;
  runId?: string | null;
  stepName?: string | null;
}

export interface AiUsageSummary {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  costUsd: string;
  durationMs: number;
  attempts: number;
}

export interface AiCompleteResult<T> {
  data: T;
  usage: AiUsageSummary;
}

export interface AiEmbedOptions {
  feature: string;
  userId?: string | null;
  workspaceId?: string | null;
  runId?: string | null;
  stepName?: string | null;
}

export interface AiEmbedResult {
  vectors: number[][];
  usage: { promptTokens: number; costUsd: string; durationMs: number };
}

// One initial attempt + one repair retry. Only 'invalid_output' ever consumes the
// second attempt — every other AiErrorType is not retryable at this layer (rate limits
// and provider outages are already retried inside the SDK's own maxRetries; by the time
// an error reaches us here, retrying again immediately would just waste money).
const MAX_ATTEMPTS = 2;

// Slack beyond max_completion_tokens for the fixed instruction text in system/user
// templates — the part of the prompt that ISN'T the truncatable variable.
const CONTEXT_OVERHEAD_MARGIN = 300;

@Injectable()
export class AiService implements OnModuleInit {
  private readonly logger = new Logger(AiService.name);
  private readonly client: OpenAI;
  private limit!: LimitFunction;

  constructor(
    private readonly env: Env,
    private readonly prompts: PromptsService,
    private readonly pricing: PricingService,
    private readonly budget: BudgetService,
    private readonly tokenCounter: TokenCounterService,
  ) {
    this.client = new OpenAI({
      apiKey: this.env.get('OPENAI_API_KEY'),
      timeout: this.env.get('OPENAI_TIMEOUT_MS'),
      maxRetries: this.env.get('OPENAI_MAX_RETRIES'),
    });
  }

  async onModuleInit() {
    // p-limit is ESM-only; dynamic import avoids relying on Node 22's require(esm)
    // interop, which the project's declared @types/node@^20 target doesn't guarantee.
    const { default: pLimit } = await import('p-limit');
    this.limit = pLimit(this.env.get('OPENAI_CONCURRENCY'));
  }

  /**
   * The single entry point every AI feature calls. Applies the budget guard, resolves
   * and renders the active prompt, calls the model with Structured Outputs, and logs
   * one token_usage row per attempt (success or failure) before returning or throwing.
   */
  async complete<T>(opts: AiCompleteOptions): Promise<AiCompleteResult<T>> {
    const userId = opts.userId ?? null;
    await this.budget.assertWithinBudget(userId);

    const template = await this.prompts.getActive(opts.promptKey);
    const variables = opts.truncateVariable
      ? this.fitVariables(template, opts.variables, opts.truncateVariable)
      : opts.variables;
    const { system, user } = this.prompts.render(template, variables);
    const messages = [
      { role: 'system' as const, content: system },
      { role: 'user' as const, content: user },
    ];
    const responseFormat = getResponseFormat(template.schemaKey);
    const temperature = Number(template.temperature);

    let lastAiError: AiError | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const startedAt = Date.now();
      try {
        const completion = await this.limit(() =>
          this.client.chat.completions.parse({
            model: template.model,
            temperature,
            max_completion_tokens: template.maxTokens,
            messages,
            response_format: responseFormat,
          }),
        );
        const durationMs = Date.now() - startedAt;
        const choice = completion.choices[0];
        const usage = completion.usage;

        // A refusal without finish_reason === 'content_filter' still comes back as a
        // normal (non-throwing) completion with parsed: null — the SDK only throws for
        // the finish_reason case, so this branch is the other half of that check.
        if (choice.message.refusal) {
          await this.logUsage(
            template,
            opts,
            usage,
            durationMs,
            attempt,
            false,
            'content_filtered',
          );
          throw Problems.aiContentFiltered();
        }
        if (choice.message.parsed == null) {
          if (attempt < MAX_ATTEMPTS) {
            await this.logUsage(
              template,
              opts,
              usage,
              durationMs,
              attempt,
              false,
              'invalid_output',
            );
            lastAiError = new AiError(
              'invalid_output',
              'Model returned no parsable output',
              true,
            );
            continue;
          }
          await this.logUsage(
            template,
            opts,
            usage,
            durationMs,
            attempt,
            false,
            'invalid_output',
          );
          throw Problems.aiOutputInvalid();
        }

        const cachedTokens = usage?.prompt_tokens_details?.cached_tokens ?? 0;
        const costUsd = this.pricing.computeCostUsd({
          model: template.model,
          promptTokens: usage?.prompt_tokens ?? 0,
          completionTokens: usage?.completion_tokens ?? 0,
          cachedTokens,
        });
        // Metering must never be able to turn a successful (already-paid-for) AI call
        // into a reported failure — a flaky insert here is a bookkeeping problem, not a
        // reason to discard a good result or mask it behind an unrelated DB error.
        await this.safeRecordUsage({
          userId,
          workspaceId: opts.workspaceId ?? null,
          runId: opts.runId ?? null,
          stepName: opts.stepName ?? null,
          feature: opts.feature,
          model: template.model,
          promptKey: template.key,
          promptVersion: template.version,
          promptTokens: usage?.prompt_tokens ?? 0,
          completionTokens: usage?.completion_tokens ?? 0,
          cachedTokens,
          costUsd,
          durationMs,
          attempts: attempt,
          success: true,
        });

        return {
          data: choice.message.parsed as T,
          usage: {
            promptTokens: usage?.prompt_tokens ?? 0,
            completionTokens: usage?.completion_tokens ?? 0,
            cachedTokens,
            costUsd,
            durationMs,
            attempts: attempt,
          },
        };
      } catch (err) {
        if (err instanceof AppException) throw err;

        const durationMs = Date.now() - startedAt;
        const aiErr = AiError.fromOpenAI(err);
        lastAiError = aiErr;
        this.logger.warn(
          `AI call failed (attempt ${attempt}/${MAX_ATTEMPTS}, feature=${opts.feature}): ${aiErr.type} — ${aiErr.message}`,
        );

        const willRetry =
          aiErr.type === 'invalid_output' && attempt < MAX_ATTEMPTS;
        await this.logUsage(
          template,
          opts,
          undefined,
          durationMs,
          attempt,
          false,
          aiErr.type,
        );
        if (!willRetry) {
          throw this.toAppException(aiErr);
        }
      }
    }

    // Unreachable: the loop always returns or throws. Satisfies the compiler only.
    throw this.toAppException(
      lastAiError ?? new AiError('unknown', 'AI call failed', false),
    );
  }

  /**
   * If the fully-rendered prompt won't fit (model context window minus reserved
   * completion tokens minus a fixed overhead margin), truncates ONLY `truncateVariable`'s
   * value by however many tokens it's over. Leaves everything else untouched — a no-op
   * when the prompt already fits, which is the common case.
   */
  private fitVariables(
    template: PromptTemplate,
    variables: Record<string, string>,
    truncateVariable: string,
  ): Record<string, string> {
    if (!(truncateVariable in variables)) return variables;

    const { system, user } = this.prompts.render(template, variables);
    const messages = [
      { role: 'system' as const, content: system },
      { role: 'user' as const, content: user },
    ];
    const budget =
      this.tokenCounter.contextWindowFor(template.model) -
      template.maxTokens -
      CONTEXT_OVERHEAD_MARGIN;
    const totalTokens = this.tokenCounter.countMessages(
      template.model,
      messages,
    );
    if (totalTokens <= budget) return variables;

    const original = variables[truncateVariable];
    const originalTokens = this.tokenCounter.countText(
      template.model,
      original,
    );
    const overshoot = totalTokens - budget;
    const newBudget = Math.max(originalTokens - overshoot, 0);

    return {
      ...variables,
      [truncateVariable]: this.tokenCounter.truncateToTokens(
        template.model,
        original,
        newBudget,
      ),
    };
  }

  /**
   * Batches a set of texts into embedding vectors. No retry/repair logic here (there's
   * no JSON schema to violate — a successful response is either the vectors or it
   * isn't), but shares the budget guard, concurrency limiter, and metering with complete().
   */
  async embed(inputs: string[], opts: AiEmbedOptions): Promise<AiEmbedResult> {
    const userId = opts.userId ?? null;
    await this.budget.assertWithinBudget(userId);

    const startedAt = Date.now();
    try {
      const response = await this.limit(() =>
        this.client.embeddings.create({
          model: DEFAULT_EMBEDDING_MODEL,
          input: inputs,
        }),
      );
      const durationMs = Date.now() - startedAt;
      const promptTokens = response.usage.prompt_tokens;
      const costUsd = this.pricing.computeEmbeddingCostUsd({
        model: DEFAULT_EMBEDDING_MODEL,
        tokens: promptTokens,
      });

      await this.safeRecordUsage({
        userId,
        workspaceId: opts.workspaceId ?? null,
        runId: opts.runId ?? null,
        stepName: opts.stepName ?? null,
        feature: opts.feature,
        model: DEFAULT_EMBEDDING_MODEL,
        promptTokens,
        completionTokens: 0,
        costUsd,
        durationMs,
        attempts: 1,
        success: true,
      });

      // Response order matches request order per the API contract, but sort explicitly
      // by index rather than trust that — cheap insurance against a caller assumption bug.
      const vectors = [...response.data]
        .sort((a, b) => a.index - b.index)
        .map((d) => d.embedding);

      return { vectors, usage: { promptTokens, costUsd, durationMs } };
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const aiErr = AiError.fromOpenAI(err);
      this.logger.warn(
        `Embedding call failed (feature=${opts.feature}): ${aiErr.type} — ${aiErr.message}`,
      );
      await this.safeRecordUsage({
        userId,
        workspaceId: opts.workspaceId ?? null,
        runId: opts.runId ?? null,
        stepName: opts.stepName ?? null,
        feature: opts.feature,
        model: DEFAULT_EMBEDDING_MODEL,
        promptTokens: 0,
        completionTokens: 0,
        costUsd: '0.000000',
        durationMs,
        attempts: 1,
        success: false,
        errorType: aiErr.type,
      });
      throw this.toAppException(aiErr);
    }
  }

  /** Never throws — a failed metering write must not mask the real outcome of the call. */
  private async safeRecordUsage(
    params: Parameters<BudgetService['recordUsage']>[0],
  ): Promise<void> {
    try {
      await this.budget.recordUsage(params);
    } catch (err) {
      this.logger.warn(
        `Failed to record token usage: ${(err as Error).message}`,
      );
    }
  }

  private logUsage(
    template: { key: string; version: number; model: string },
    opts: AiCompleteOptions,
    usage: OpenAI.CompletionUsage | undefined,
    durationMs: number,
    attempt: number,
    success: boolean,
    errorType?: string,
  ) {
    return this.safeRecordUsage({
      userId: opts.userId ?? null,
      workspaceId: opts.workspaceId ?? null,
      runId: opts.runId ?? null,
      stepName: opts.stepName ?? null,
      feature: opts.feature,
      model: template.model,
      promptKey: template.key,
      promptVersion: template.version,
      promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? 0,
      cachedTokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
      costUsd: this.pricing.computeCostUsd({
        model: template.model,
        promptTokens: usage?.prompt_tokens ?? 0,
        completionTokens: usage?.completion_tokens ?? 0,
        cachedTokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
      }),
      durationMs,
      attempts: attempt,
      success,
      errorType,
    });
  }

  private toAppException(aiErr: AiError): AppException {
    switch (aiErr.type) {
      case 'rate_limited':
      case 'provider_down':
        return Problems.aiProviderUnavailable();
      case 'invalid_output':
        return Problems.aiOutputInvalid();
      case 'context_too_long':
        return Problems.aiContextTooLong();
      case 'budget_exceeded':
        return Problems.aiBudgetExceeded('user');
      case 'content_filtered':
        return Problems.aiContentFiltered();
      default:
        return new AppException(
          ErrorCode.INTERNAL_ERROR,
          'AI request failed unexpectedly.',
        );
    }
  }
}
