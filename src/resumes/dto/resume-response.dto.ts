import { ApiProperty } from '@nestjs/swagger';
import { Resume } from '../entities/resume.entity';

// Deliberately never includes rawText (large) or userId (ownership is implicit —
// every route this DTO comes back from already scoped the query to the caller).
export class ResumeResponse {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiProperty() status: string;
  @ApiProperty({ nullable: true }) pageCount: number | null;
  @ApiProperty({ nullable: true }) wordCount: number | null;
  @ApiProperty() fileSize: number;
  @ApiProperty({ nullable: true }) language: string | null;
  @ApiProperty({ nullable: true }) parseError: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;

  constructor(r: Resume) {
    Object.assign(this, {
      id: r.id,
      title: r.title,
      status: r.status,
      pageCount: r.pageCount,
      wordCount: r.wordCount,
      fileSize: r.fileSize,
      language: r.language,
      parseError: r.parseError,
      createdAt: r.createdAt,
    });
  }
}
