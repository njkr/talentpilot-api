import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { User } from 'src/auth/entities/user.entity';
import { Problems } from 'src/common/problems';
import { CursorQueryDto } from 'src/common/dto/cursor-query.dto';
import {
  ApiDataResponse,
  ApiErrorResponses,
  ApiNoContentResponse,
} from 'src/common/swagger/api-response.decorator';
import { JobDescriptionsService } from './job-descriptions.service';
import { PasteJdDto } from './dto/paste-jd.dto';
import { UpdateJdDto } from './dto/update-jd.dto';
import { JdResponse } from './dto/jd-response.dto';

@ApiTags('job-descriptions')
@ApiBearerAuth('access-token')
@Controller('job-descriptions')
export class JobDescriptionsController {
  constructor(private readonly jds: JobDescriptionsService) {}

  @Post('paste')
  @ApiOperation({
    summary: 'Paste a job description',
    description:
      'Analysed inline (a few seconds) — the response already carries the parsed ' +
      'requirements and skills. Pasting the same text twice returns the existing ' +
      'analysed row instead of paying for a second AI call.',
  })
  @ApiDataResponse(201, JdResponse, 'Analysed.')
  @ApiErrorResponses({
    422: 'Text is too short to be a real job description (JD_TOO_SHORT).',
  })
  async paste(@CurrentUser() user: User, @Body() dto: PasteJdDto) {
    return new JdResponse(
      await this.jds.paste(user.id, dto.text, dto.position, dto.company),
    );
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload a job description as a PDF or DOCX file',
  })
  @ApiDataResponse(201, JdResponse, 'Analysed.')
  @ApiErrorResponses({
    422: 'Not a real PDF/DOCX, or the extracted text is too short (JD_TOO_SHORT).',
  })
  async upload(
    @CurrentUser() user: User,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw Problems.fileTypeUnsupported();
    return new JdResponse(await this.jds.upload(user.id, file));
  }

  @Get()
  @ApiOperation({
    summary: 'List job descriptions (cursor-paginated, newest first)',
  })
  @ApiDataResponse(200, JdResponse, 'A page of job descriptions.', {
    isArray: true,
  })
  async list(@CurrentUser() user: User, @Query() q: CursorQueryDto) {
    const { data, hasMore, nextCursor } = await this.jds.list(user.id, q);
    return { data: data.map((jd) => new JdResponse(jd)), hasMore, nextCursor };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single job description' })
  @ApiDataResponse(200, JdResponse, 'The job description.')
  @ApiErrorResponses({
    404: 'No job description with that id belongs to the current user.',
  })
  async get(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return new JdResponse(await this.jds.findOwned(id, user.id));
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Fill in company/position the AI parse (or upload) came up without',
    description:
      'Corrects JdResponse.missingFields — most useful right after upload(), which ' +
      'has no fields to pass at ingest time. Does not re-run analysis; the caller is ' +
      'asserting ground truth. Recommended before triggering analyze() on a workspace ' +
      'so the pipeline has a company to research and a real position to write toward, ' +
      'rather than the user discovering the gap only after a partial run.',
  })
  @ApiDataResponse(200, JdResponse, 'Updated.')
  @ApiErrorResponses({
    404: 'No job description with that id belongs to the current user.',
  })
  async update(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateJdDto,
  ) {
    return new JdResponse(await this.jds.updateFields(id, user.id, dto));
  }

  @Post(':id/retry')
  @ApiOperation({
    summary: 'Retry a failed analysis',
    description:
      'Only meaningful when status is `failed` — re-runs the jd_analysis prompt.',
  })
  @ApiDataResponse(200, JdResponse, 'Re-analysed.')
  @ApiErrorResponses({
    404: 'No job description with that id belongs to the current user.',
  })
  async retry(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return new JdResponse(await this.jds.retry(id, user.id));
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a job description (soft delete)' })
  @ApiNoContentResponse(204, 'Deleted.')
  @ApiErrorResponses({
    404: 'No job description with that id belongs to the current user.',
  })
  async remove(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.jds.remove(id, user.id);
  }
}
