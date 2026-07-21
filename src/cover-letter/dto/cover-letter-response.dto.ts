import { ApiProperty } from '@nestjs/swagger';
import { CoverLetter } from '../entities/cover-letter.entity';

export class CoverLetterResponse {
  @ApiProperty() id: string;
  @ApiProperty() workspaceId: string;
  @ApiProperty() version: number;
  @ApiProperty() tone: string;
  @ApiProperty() length: string;
  @ApiProperty() content: string;
  @ApiProperty() wordCount: number;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;

  constructor(l: CoverLetter) {
    Object.assign(this, {
      id: l.id,
      workspaceId: l.workspaceId,
      version: l.version,
      tone: l.tone,
      length: l.length,
      content: l.content,
      wordCount: l.wordCount,
      createdAt: l.createdAt,
    });
  }
}
