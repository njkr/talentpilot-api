import { ApiProperty } from '@nestjs/swagger';
import {
  DocType,
  GeneratedDocument,
} from '../entities/generated-document.entity';

export class DocumentResponse {
  @ApiProperty() id: string;
  @ApiProperty() workspaceId: string;
  @ApiProperty() type: DocType;
  @ApiProperty() filename: string;
  @ApiProperty() status: string;
  @ApiProperty({ required: false, nullable: true }) fileSize: number | null;
  @ApiProperty({ required: false, nullable: true }) error: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: Date;

  constructor(d: GeneratedDocument) {
    Object.assign(this, {
      id: d.id,
      workspaceId: d.workspaceId,
      type: d.type,
      filename: d.filename,
      status: d.status,
      fileSize: d.fileSize,
      error: d.error,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    });
  }
}

export class DocumentDownloadResponse {
  @ApiProperty() url: string;
  @ApiProperty() filename: string;

  constructor(url: string, filename: string) {
    this.url = url;
    this.filename = filename;
  }
}
