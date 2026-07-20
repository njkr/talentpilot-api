import { ApiProperty } from '@nestjs/swagger';
import { ResumeSection } from '../entities/resume-section.entity';

export class SectionResponse {
  @ApiProperty() sectionType: string;
  @ApiProperty({ type: 'object', additionalProperties: true })
  content: unknown;
  @ApiProperty() orderIndex: number;
  @ApiProperty({ nullable: true }) confidence: number | null;
  @ApiProperty() aiGenerated: boolean;
  @ApiProperty() editedByUser: boolean;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: Date;

  constructor(s: ResumeSection) {
    Object.assign(this, {
      sectionType: s.sectionType,
      content: s.content,
      orderIndex: s.orderIndex,
      confidence: s.confidence === null ? null : Number(s.confidence),
      aiGenerated: s.aiGenerated,
      editedByUser: s.editedByUser,
      updatedAt: s.updatedAt,
    });
  }
}
