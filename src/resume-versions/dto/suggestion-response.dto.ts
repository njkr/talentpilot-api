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
  @ApiProperty()
  status: 'pending' | 'accepted' | 'rejected' | 'stale' | 'needs_info';
  @ApiProperty({
    nullable: true,
    description:
      'Only set when status is "needs_info" — what kind of real detail would make ' +
      'this suggestion usable (e.g. "a specific metric or number").',
  })
  missingFact: string | null;
  @ApiProperty({
    nullable: true,
    description:
      'Only set when status is "needs_info" — the AI\'s own invented text, an ' +
      'illustrative example only. Never apply this value unedited.',
  })
  exampleValue: string | null;
  @ApiProperty({
    description:
      'Only meaningful when status is "needs_info". When true, this is an ' +
      'unsupported-skill violation (a claimed technology/keyword with zero evidence ' +
      'anywhere in the resume) — resubmitting text via provide-detail can NEVER ' +
      "resolve this, since it checks against the resume's frozen original text. Point " +
      "the user at editing their resume's Skills section directly instead of the usual " +
      'text-box retry. false for every other needs_info case (missing number/year/org/' +
      'credential), where provide-detail is the right next step.',
  })
  needsDirectEdit: boolean;

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
      missingFact: s.missingFact,
      exampleValue: s.exampleValue,
      needsDirectEdit: s.needsDirectEdit,
    });
  }
}
