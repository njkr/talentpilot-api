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
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { User } from 'src/auth/entities/user.entity';
import { VerifiedGuard } from 'src/auth/guards/verified.guard';
import { Problems } from 'src/common/problems';
import { CursorQueryDto } from 'src/common/dto/cursor-query.dto';
import {
  ApiDataResponse,
  ApiErrorResponses,
  ApiNoContentResponse,
} from 'src/common/swagger/api-response.decorator';
import { ResumesService } from './resumes.service';
import { ResumeResponse } from './dto/resume-response.dto';
import { RenameResumeDto } from './dto/rename-resume.dto';

@ApiTags('resumes')
@ApiBearerAuth('access-token')
@Controller('resumes')
export class ResumesController {
  constructor(private readonly resumes: ResumesService) {}

  @Post('upload')
  @UseGuards(VerifiedGuard) // unverified users can't upload
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } }) // 10/hour
  // Storage + limits (memoryStorage, MAX_FILE_SIZE_MB) come from the MulterModule
  // registered in ResumesModule — see there for why that can't live in this decorator.
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload a resume',
    description:
      'PDF or DOCX only, validated by magic bytes (never trusts the extension or ' +
      'Content-Type). Re-uploading an identical file returns the existing resume ' +
      'instead of creating a duplicate. Kicks off text extraction on the worker — the ' +
      'response comes back at status `uploaded`; poll or refetch to see it progress.',
  })
  @ApiDataResponse(
    201,
    ResumeResponse,
    'Uploaded (or the existing match for this content).',
  )
  @ApiErrorResponses({
    403: 'Email not verified, or plan resume limit reached (PLAN_LIMIT_REACHED).',
    413: 'File exceeds MAX_FILE_SIZE_MB.',
    422: 'Not a real PDF/DOCX by magic bytes, or the PDF has more than MAX_RESUME_PAGES.',
    429: 'More than 10 uploads/hour.',
  })
  async upload(
    @CurrentUser() user: User,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw Problems.fileTypeUnsupported();
    return new ResumeResponse(await this.resumes.upload(user, file));
  }

  @Get()
  @ApiOperation({ summary: 'List resumes (cursor-paginated, newest first)' })
  @ApiDataResponse(200, ResumeResponse, 'A page of resumes.', { isArray: true })
  async list(@CurrentUser() user: User, @Query() q: CursorQueryDto) {
    const { data, hasMore, nextCursor } = await this.resumes.list(user.id, q);
    return {
      data: data.map((r) => new ResumeResponse(r)),
      hasMore,
      nextCursor,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single resume' })
  @ApiDataResponse(200, ResumeResponse, 'The resume.')
  @ApiErrorResponses({
    404: 'No resume with that id belongs to the current user.',
  })
  async get(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return new ResumeResponse(await this.resumes.findOwned(id, user.id));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename a resume' })
  @ApiDataResponse(200, ResumeResponse, 'Renamed.')
  @ApiErrorResponses({
    404: 'No resume with that id belongs to the current user.',
  })
  async rename(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenameResumeDto,
  ) {
    return new ResumeResponse(
      await this.resumes.rename(id, user.id, dto.title),
    );
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete a resume',
    description:
      'Soft delete. Blocked (409) if any workspace still references this resume — ' +
      'delete those first. The response lists exactly which ones.',
  })
  @ApiNoContentResponse(204, 'Deleted.')
  @ApiErrorResponses({
    404: 'No resume with that id belongs to the current user.',
    409: 'RESUME_IN_USE — one or more workspaces still reference this resume.',
  })
  async remove(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.resumes.remove(id, user.id);
  }

  @Get(':id/download')
  @ApiOperation({
    summary: 'Get a signed download link',
    description:
      'The API never streams file bytes itself — this redirects to a short-lived ' +
      'signed URL (SIGNED_URL_TTL_SEC) that the browser fetches directly from storage.',
  })
  @ApiErrorResponses({
    404: 'No resume with that id belongs to the current user.',
  })
  async download(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const url = await this.resumes.getDownloadUrl(id, user.id);
    res.redirect(302, url);
  }

  @Post(':id/retry')
  @ApiOperation({
    summary: 'Retry a failed extraction',
    description:
      'Only valid when status is `failed` — re-queues text extraction.',
  })
  @ApiDataResponse(
    200,
    ResumeResponse,
    'Re-queued; status reset to `uploaded`.',
  )
  @ApiErrorResponses({
    404: 'No resume with that id belongs to the current user.',
    409: 'Resume is not in a `failed` state (RESUME_NOT_PARSED).',
  })
  async retry(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return new ResumeResponse(await this.resumes.retry(id, user.id));
  }
}
