/**
 * Single source of truth for "what do we know about this model" — pricing and
 * TokenCounterService both key off this instead of keeping their own model lists, so
 * adding a model can't leave pricing right but context-window checks stale (or vice versa).
 */
export interface ModelSpec {
  contextWindow: number;
  pricing: {
    promptPerM: number; // USD per 1M prompt tokens, non-cached
    cachedPromptPerM: number; // USD per 1M prompt tokens served from the provider's cache
    completionPerM: number; // USD per 1M completion tokens
  };
}

// Rates as published by OpenAI; revisit if they change pricing.
export const MODEL_CATALOG: Record<string, ModelSpec> = {
  'gpt-4o-mini': {
    contextWindow: 128_000,
    pricing: { promptPerM: 0.15, cachedPromptPerM: 0.075, completionPerM: 0.6 },
  },
  'gpt-4o': {
    contextWindow: 128_000,
    pricing: { promptPerM: 2.5, cachedPromptPerM: 1.25, completionPerM: 10 },
  },
  'gpt-4.1-mini': {
    contextWindow: 1_047_576,
    pricing: { promptPerM: 0.4, cachedPromptPerM: 0.1, completionPerM: 1.6 },
  },
  'gpt-4.1': {
    contextWindow: 1_047_576,
    pricing: { promptPerM: 2, cachedPromptPerM: 0.5, completionPerM: 8 },
  },
};

/**
 * Throws rather than falling back to a default: an unpriced model would otherwise bill
 * silently wrong or bypass context-length checks, and both fail loud is strictly better.
 */
export function getModelSpec(model: string): ModelSpec {
  const spec = MODEL_CATALOG[model];
  if (!spec) {
    throw new Error(`Unknown model "${model}" — add it to MODEL_CATALOG first`);
  }
  return spec;
}

export interface EmbeddingModelSpec {
  dimensions: number;
  maxInputTokens: number; // per input item, not per request
  pricePerM: number; // USD per 1M input tokens — embeddings have no completion tokens
}

export const EMBEDDING_MODEL_CATALOG: Record<string, EmbeddingModelSpec> = {
  'text-embedding-3-small': {
    dimensions: 1536,
    maxInputTokens: 8191,
    pricePerM: 0.02,
  },
  'text-embedding-3-large': {
    dimensions: 3072,
    maxInputTokens: 8191,
    pricePerM: 0.13,
  },
};

// The one embedding model this deployment actually uses. Single source of truth for
// AiService (what it calls), ChunkerService (what it token-counts against), and the
// `embeddings.embedding` column (vector(1536), sized for this model's dimensions) —
// change it here and the column width in the migration together, not separately.
export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';

export function getEmbeddingModelSpec(model: string): EmbeddingModelSpec {
  const spec = EMBEDDING_MODEL_CATALOG[model];
  if (!spec) {
    throw new Error(
      `Unknown embedding model "${model}" — add it to EMBEDDING_MODEL_CATALOG first`,
    );
  }
  return spec;
}
