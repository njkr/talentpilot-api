import { MatchResponse } from './match-response.dto';
import { MatchResult } from '../matching.facade';
import { KeywordMatch } from '../services/keyword-matcher.service';

function kw(
  keyword: string,
  importance: KeywordMatch['importance'],
  status: KeywordMatch['status'],
): KeywordMatch {
  return {
    keyword,
    canonical: keyword.toLowerCase(),
    category: 'tool',
    importance,
    status,
    foundIn: [],
    source: 'exact',
  };
}

function result(keywords: KeywordMatch[]): MatchResult {
  return {
    semantic: { semanticScore: 50, perRequirement: [] },
    keywords,
    stats: {
      resume: { embedded: 0, reused: 0 },
      jd: { embedded: 0, reused: 0 },
    },
  };
}

describe('MatchResponse coverage', () => {
  it('counts required/preferred matched vs. missing and lists the missing required keywords', () => {
    const response = new MatchResponse(
      result([
        kw('Unity', 'required', 'missing'),
        kw('C#', 'required', 'missing'),
        kw('Git', 'required', 'matched'),
        kw('Firebase', 'preferred', 'missing'),
        kw('DOTween', 'preferred', 'matched'),
      ]),
    );

    expect(response.coverage).toEqual({
      requiredTotal: 3,
      requiredMatched: 1,
      requiredMissing: 2,
      preferredTotal: 2,
      preferredMatched: 1,
      missingRequiredKeywords: ['Unity', 'C#'],
    });
  });

  it('is all-zero for a JD with no keywords extracted', () => {
    const response = new MatchResponse(result([]));
    expect(response.coverage).toEqual({
      requiredTotal: 0,
      requiredMatched: 0,
      requiredMissing: 0,
      preferredTotal: 0,
      preferredMatched: 0,
      missingRequiredKeywords: [],
    });
  });

  it('does not count "partial" as matched', () => {
    const response = new MatchResponse(
      result([kw('Vue', 'required', 'partial')]),
    );
    expect(response.coverage.requiredMatched).toBe(0);
    expect(response.coverage.requiredMissing).toBe(0); // partial isn't "missing" either
  });
});
