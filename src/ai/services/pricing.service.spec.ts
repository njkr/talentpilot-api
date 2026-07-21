import { PricingService } from './pricing.service';

describe('PricingService', () => {
  const service = new PricingService();

  it('computes cost for a call with no cached tokens', () => {
    // gpt-4o-mini: $0.15/1M prompt, $0.60/1M completion
    const cost = service.computeCostUsd({
      model: 'gpt-4o-mini',
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
      cachedTokens: 0,
    });
    expect(cost).toBe('0.750000');
  });

  it('bills cached tokens at the cached rate, not the full rate', () => {
    // All 1M prompt tokens cached: $0.075/1M instead of $0.15/1M.
    const cost = service.computeCostUsd({
      model: 'gpt-4o-mini',
      promptTokens: 1_000_000,
      completionTokens: 0,
      cachedTokens: 1_000_000,
    });
    expect(cost).toBe('0.075000');
  });

  it('returns a fixed 6-decimal string even for tiny amounts', () => {
    const cost = service.computeCostUsd({
      model: 'gpt-4o-mini',
      promptTokens: 100,
      completionTokens: 50,
      cachedTokens: 0,
    });
    expect(cost).toMatch(/^\d+\.\d{6}$/);
  });

  it('throws for an unpriced model instead of silently defaulting', () => {
    expect(() =>
      service.computeCostUsd({
        model: 'not-a-real-model',
        promptTokens: 100,
        completionTokens: 100,
      }),
    ).toThrow(/Unknown model/);
  });

  describe('computeEmbeddingCostUsd', () => {
    it('bills embeddings at a flat per-input-token rate (no completion tokens)', () => {
      // text-embedding-3-small: $0.02/1M tokens
      const cost = service.computeEmbeddingCostUsd({
        model: 'text-embedding-3-small',
        tokens: 1_000_000,
      });
      expect(cost).toBe('0.020000');
    });

    it('throws for an unpriced embedding model', () => {
      expect(() =>
        service.computeEmbeddingCostUsd({
          model: 'not-a-real-model',
          tokens: 100,
        }),
      ).toThrow(/Unknown embedding model/);
    });
  });
});
