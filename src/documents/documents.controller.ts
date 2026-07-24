import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { User } from 'src/auth/entities/user.entity';
import {
  ApiDataResponse,
  ApiErrorResponses,
} from 'src/common/swagger/api-response.decorator';
import { DocumentsService } from './documents.service';
import { RequestDocumentDto } from './dto/request-document.dto';
import {
  DocumentDownloadResponse,
  DocumentResponse,
} from './dto/document-response.dto';

@ApiTags('documents')
@ApiBearerAuth('access-token')
@Controller('workspaces/:id/documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post()
  @ApiOperation({
    summary: 'Queue generation of a resume/cover-letter/report document',
  })
  @ApiDataResponse(
    201,
    DocumentResponse,
    'The queued document (poll GET :docId for status).',
  )
  @ApiErrorResponses({
    404: 'No workspace with that id belongs to the current user.',
  })
  async request(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestDocumentDto,
  ) {
    return new DocumentResponse(
      await this.documents.request(id, user.id, dto.type),
    );
  }

  @Get()
  @ApiOperation({
    summary: 'List every document ever generated for this workspace',
  })
  @ApiDataResponse(200, DocumentResponse, 'Newest first.', { isArray: true })
  async list(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const docs = await this.documents.list(id, user.id);
    return docs.map((d) => new DocumentResponse(d));
  }

  @Get(':docId')
  @ApiOperation({ summary: "Poll a document's generation status" })
  @ApiDataResponse(200, DocumentResponse, 'Current status.')
  @ApiErrorResponses({ 404: 'No such document in this workspace.' })
  async getOne(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('docId', ParseUUIDPipe) docId: string,
  ) {
    return new DocumentResponse(await this.documents.get(id, user.id, docId));
  }

  @Get(':docId/download')
  @ApiOperation({
    summary: 'Get a short-lived signed download URL for a ready document',
  })
  @ApiDataResponse(
    200,
    DocumentDownloadResponse,
    'A signed S3 URL, valid briefly.',
  )
  @ApiErrorResponses({
    404: 'No such document in this workspace.',
    409: 'DOCUMENT_NOT_READY — still generating, stale, or failed.',
  })
  async download(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('docId', ParseUUIDPipe) docId: string,
  ) {
    const { url, filename } = await this.documents.downloadUrl(
      id,
      user.id,
      docId,
    );
    return new DocumentDownloadResponse(url, filename);
  }
}
