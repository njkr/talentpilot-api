import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { DocType } from '../entities/generated-document.entity';

const DOC_TYPES: DocType[] = [
  'resume_pdf',
  'resume_docx',
  'cover_letter_pdf',
  'cover_letter_docx',
  'full_report_pdf',
];

export class RequestDocumentDto {
  @ApiProperty({ enum: DOC_TYPES })
  @IsIn(DOC_TYPES)
  type: DocType;
}
