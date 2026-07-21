import { Injectable } from '@nestjs/common';
import { getEmbeddingModelSpec, getModelSpec } from '../model-catalog';

export interface UsageInput {
  model: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
}

@Injectable()
export class PricingService {
  /** Returns cost as a fixed 6-decimal string, ready to hand straight to TokenUsage.costUsd. */
  computeCostUsd({
    model,
    promptTokens,
    completionTokens,
    cachedTokens = 0,
  }: UsageInput): string {
    const { pricing } = getModelSpec(model);
    const billablePrompt = Math.max(promptTokens - cachedTokens, 0);

    const cost =
      (billablePrompt / 1_000_000) * pricing.promptPerM +
      (cachedTokens / 1_000_000) * pricing.cachedPromptPerM +
      (completionTokens / 1_000_000) * pricing.completionPerM;

    return cost.toFixed(6);
  }

  /** Embeddings have no completion/cached split — just input tokens at a flat rate. */
  computeEmbeddingCostUsd({
    model,
    tokens,
  }: {
    model: string;
    tokens: number;
  }): string {
    const { pricePerM } = getEmbeddingModelSpec(model);
    return ((tokens / 1_000_000) * pricePerM).toFixed(6);
  }
}
