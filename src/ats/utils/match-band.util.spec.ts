import { computeMatchBand } from './match-band.util';
import { AtsKeywordMatch } from '../entities/ats-keyword-match.entity';

function kw(
  importance: AtsKeywordMatch['importance'],
  status: AtsKeywordMatch['status'],
): AtsKeywordMatch {
  return { importance, status } as AtsKeywordMatch;
}

describe('computeMatchBand', () => {
  it('is "strong" when 70% or more of required keywords are matched', () => {
    const result = computeMatchBand([
      kw('required', 'matched'),
      kw('required', 'matched'),
      kw('required', 'matched'),
      kw('required', 'missing'),
      kw('preferred', 'missing'), // preferred keywords never affect the band
    ]);
    expect(result).toEqual({
      band: 'strong',
      requiredMet: 3,
      requiredTotal: 4,
    });
  });

  it('is "fair" between 35% and 70% of required keywords matched', () => {
    const result = computeMatchBand([
      kw('required', 'matched'),
      kw('required', 'matched'),
      kw('required', 'missing'),
      kw('required', 'missing'),
      kw('required', 'missing'),
    ]);
    expect(result).toEqual({ band: 'fair', requiredMet: 2, requiredTotal: 5 });
  });

  it('is "low" below 35% of required keywords matched', () => {
    const result = computeMatchBand([
      kw('required', 'missing'),
      kw('required', 'missing'),
      kw('required', 'missing'),
      kw('required', 'missing'),
    ]);
    expect(result).toEqual({ band: 'low', requiredMet: 0, requiredTotal: 4 });
  });

  it('defaults to "strong" when the JD has no required keywords at all — nothing to fail', () => {
    const result = computeMatchBand([kw('preferred', 'missing')]);
    expect(result).toEqual({
      band: 'strong',
      requiredMet: 0,
      requiredTotal: 0,
    });
  });

  it('counts "partial" as not-met, same as "missing"', () => {
    const result = computeMatchBand([
      kw('required', 'matched'),
      kw('required', 'partial'),
    ]);
    expect(result).toEqual({ band: 'fair', requiredMet: 1, requiredTotal: 2 });
  });
});
