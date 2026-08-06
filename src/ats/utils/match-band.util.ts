import { AtsKeywordMatch } from '../entities/ats-keyword-match.entity';

export type MatchBand = 'low' | 'fair' | 'strong';

export interface MatchBandResult {
  band: MatchBand;
  requiredMet: number;
  requiredTotal: number;
}

// Reframes the raw score as a verdict about fit for THIS job, not a grade on the
// resume — "you meet 2 of 6 required skills" lands very differently than "27/100".
// Pure derivation from data already stored on the report; no new AI call.
const STRONG_THRESHOLD = 0.7;
const FAIR_THRESHOLD = 0.35;

export function computeMatchBand(keywords: AtsKeywordMatch[]): MatchBandResult {
  const required = keywords.filter((k) => k.importance === 'required');
  const requiredTotal = required.length;
  const requiredMet = required.filter((k) => k.status === 'matched').length;

  // Nothing required by the JD — nothing to fail, so this can't be a low match.
  if (requiredTotal === 0) {
    return { band: 'strong', requiredMet: 0, requiredTotal: 0 };
  }

  const ratio = requiredMet / requiredTotal;
  const band: MatchBand =
    ratio >= STRONG_THRESHOLD
      ? 'strong'
      : ratio >= FAIR_THRESHOLD
        ? 'fair'
        : 'low';

  return { band, requiredMet, requiredTotal };
}
