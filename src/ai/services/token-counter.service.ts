import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Tiktoken, encodingForModel } from 'js-tiktoken';
import type { TiktokenModel } from 'js-tiktoken';
import { getModelSpec } from '../model-catalog';

export interface ChatMessageLike {
  role: string;
  name?: string;
  content: string;
}

/**
 * Estimates tokens BEFORE we call the API — for pre-flight context-length checks and
 * budget projections. The real, billable token counts always come back on
 * `response.usage` from OpenAI itself; this is never used to bill.
 */
@Injectable()
export class TokenCounterService implements OnModuleDestroy {
  // Building an encoder isn't free, and it's the same table for every model that shares
  // it, so cache by model rather than re-loading per call.
  private readonly encoders = new Map<string, Tiktoken>();

  private encoderFor(model: string): Tiktoken {
    let enc = this.encoders.get(model);
    if (!enc) {
      enc = encodingForModel(model as TiktokenModel);
      this.encoders.set(model, enc);
    }
    return enc;
  }

  countText(model: string, text: string): number {
    return this.encoderFor(model).encode(text).length;
  }

  /**
   * Chat-completion token count, per OpenAI's own counting formula: 3 tokens of
   * overhead per message, +1 if it carries a `name`, plus 3 for the assistant reply
   * primer. This is an approximation the API itself confirms as "close enough for
   * pre-flight" — it does not model tool-calls or image inputs.
   */
  countMessages(model: string, messages: ChatMessageLike[]): number {
    const enc = this.encoderFor(model);
    let total = 0;
    for (const message of messages) {
      total += 3;
      total += enc.encode(message.content).length;
      total += enc.encode(message.role).length;
      if (message.name) {
        total += enc.encode(message.name).length + 1;
      }
    }
    return total + 3;
  }

  /** Truncates to at most `maxTokens` tokens for this model's encoding. No-op if it already fits. */
  truncateToTokens(model: string, text: string, maxTokens: number): string {
    const enc = this.encoderFor(model);
    const tokens = enc.encode(text);
    if (tokens.length <= maxTokens) return text;
    return enc.decode(tokens.slice(0, maxTokens));
  }

  contextWindowFor(model: string): number {
    return getModelSpec(model).contextWindow;
  }

  fitsContextWindow(
    model: string,
    messages: ChatMessageLike[],
    reserveForCompletion: number,
  ): boolean {
    return (
      this.countMessages(model, messages) + reserveForCompletion <=
      this.contextWindowFor(model)
    );
  }

  onModuleDestroy() {
    this.encoders.clear();
  }
}
