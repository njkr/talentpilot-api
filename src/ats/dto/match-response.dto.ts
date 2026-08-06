import { ApiProperty } from '@nestjs/swagger';
import { MatchResult } from '../matching.facade';

export interface MatchCoverage {
  requiredTotal: number;
  requiredMatched: number;
  requiredMissing: number;
  preferredTotal: number;
  preferredMatched: number;
  missingRequiredKeywords: string[];
}

// Cheap enough to check BEFORE spending analysis credits on a badly-matched JD — this
// endpoint already runs (and isn't credit-gated) without this field; coverage is a
// pure derivation of the keyword list it already computes, no new query/AI call.
function computeCoverage(keywords: MatchResult['keywords']): MatchCoverage {
  const required = keywords.filter((k) => k.importance === 'required');
  const preferred = keywords.filter((k) => k.importance === 'preferred');
  const missingRequired = required.filter((k) => k.status === 'missing');
  return {
    requiredTotal: required.length,
    requiredMatched: required.filter((k) => k.status === 'matched').length,
    requiredMissing: missingRequired.length,
    preferredTotal: preferred.length,
    preferredMatched: preferred.filter((k) => k.status === 'matched').length,
    missingRequiredKeywords: missingRequired.map((k) => k.keyword),
  };
}

export class MatchResponse {
  @ApiProperty({ description: 'Overall weighted semantic score, 0-100.' })
  semanticScore: number;

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  perRequirement: MatchResult['semantic']['perRequirement'];

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  keywords: MatchResult['keywords'];

  @ApiProperty({ type: 'object', additionalProperties: true })
  stats: MatchResult['stats'];

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'Required/preferred keyword coverage — check this before spending analysis ' +
      'credits on a badly-matched job description.',
  })
  coverage: MatchCoverage;

  constructor(result: MatchResult) {
    this.semanticScore = result.semantic.semanticScore;
    this.perRequirement = result.semantic.perRequirement;
    this.keywords = result.keywords;
    this.stats = result.stats;
    this.coverage = computeCoverage(result.keywords);
  }
}
