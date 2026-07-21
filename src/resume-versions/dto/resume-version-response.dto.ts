import { ApiProperty } from '@nestjs/swagger';
import { ResumeVersion } from '../entities/resume-version.entity';

export class ResumeVersionResponse {
  @ApiProperty() id: string;
  @ApiProperty() version: number;
  @ApiProperty() label: string;
  @ApiProperty() changeSummary: string;
  @ApiProperty() createdBy: 'user' | 'ai' | 'restore';
  @ApiProperty() suggestionsApplied: number;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;

  constructor(v: ResumeVersion) {
    Object.assign(this, {
      id: v.id,
      version: v.version,
      label: v.label,
      changeSummary: v.changeSummary,
      createdBy: v.createdBy,
      suggestionsApplied: v.suggestionsApplied,
      createdAt: v.createdAt,
    });
  }
}
