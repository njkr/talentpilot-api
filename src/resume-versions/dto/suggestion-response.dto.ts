import { ApiProperty } from '@nestjs/swagger';
import { AiSuggestion } from '../../suggestions/entities/ai-suggestion.entity';

export class SuggestionResponse {
  @ApiProperty() id: string;
  @ApiProperty() sectionType: string;
  @ApiProperty({ nullable: true }) itemIndex: number | null;
  @ApiProperty({ nullable: true }) bulletIndex: number | null;
  @ApiProperty() oldText: string;
  @ApiProperty() newText: string;
  @ApiProperty() reason: string;
  @ApiProperty() impact: 'high' | 'medium' | 'low';
  @ApiProperty({ type: [String] }) keywordsAdded: string[];
  @ApiProperty() status: 'pending' | 'accepted' | 'rejected' | 'stale';

  constructor(s: AiSuggestion) {
    Object.assign(this, {
      id: s.id,
      sectionType: s.sectionType,
      itemIndex: s.itemIndex,
      bulletIndex: s.bulletIndex,
      oldText: s.oldText,
      newText: s.newText,
      reason: s.reason,
      impact: s.impact,
      keywordsAdded: s.keywordsAdded,
      status: s.status,
    });
  }
}
