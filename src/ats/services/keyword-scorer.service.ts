import { Injectable } from '@nestjs/common';
import { KeywordMatch } from './keyword-matcher.service';

export interface KeywordScoreResult {
  score: number;
  breakdown: {
    matched: number;
    partial: number;
    missing: number;
    missingRequired: number;
  } | null;
}

const IMPORTANCE_WEIGHT = {
  required: 3,
  preferred: 2,
  nice_to_have: 1,
} as const;
const STATUS_CREDIT = { matched: 1, partial: 0.5, missing: 0 } as const;

@Injectable()
export class KeywordScorerService {
  /**
   * Weighted coverage. A resume missing one required skill but holding six
   * nice-to-haves should NOT outscore one that nails every requirement.
   */
  score(matches: KeywordMatch[]): KeywordScoreResult {
    if (!matches.length) return { score: 0, breakdown: null };

    let earned = 0;
    let possible = 0;
    for (const m of matches) {
      const weight = IMPORTANCE_WEIGHT[m.importance];
      possible += weight;
      earned += weight * STATUS_CREDIT[m.status];
    }

    const breakdown = {
      matched: matches.filter((m) => m.status === 'matched').length,
      partial: matches.filter((m) => m.status === 'partial').length,
      missing: matches.filter((m) => m.status === 'missing').length,
      missingRequired: matches.filter(
        (m) => m.status === 'missing' && m.importance === 'required',
      ).length,
    };

    return { score: Math.round((earned / possible) * 100), breakdown };
  }
}
