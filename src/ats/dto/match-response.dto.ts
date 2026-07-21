import { ApiProperty } from '@nestjs/swagger';
import { MatchResult } from '../matching.facade';

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

  constructor(result: MatchResult) {
    this.semanticScore = result.semantic.semanticScore;
    this.perRequirement = result.semantic.perRequirement;
    this.keywords = result.keywords;
    this.stats = result.stats;
  }
}
