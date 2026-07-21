import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { User } from 'src/auth/entities/user.entity';
import {
  ApiDataResponse,
  ApiErrorResponses,
} from 'src/common/swagger/api-response.decorator';
import { ResumeVersionsService } from './resume-versions.service';
import { ResumeVersionResponse } from './dto/resume-version-response.dto';

@ApiTags('resume-versions')
@ApiBearerAuth('access-token')
@Controller('resumes/:id/versions')
export class ResumeVersionsController {
  constructor(private readonly versions: ResumeVersionsService) {}

  @Get()
  @ApiOperation({ summary: 'List a resume’s version history, newest first' })
  @ApiDataResponse(200, ResumeVersionResponse, 'Version history.', {
    isArray: true,
  })
  @ApiErrorResponses({
    404: 'No resume with that id belongs to the current user.',
  })
  async list(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const rows = await this.versions.listVersions(id, user.id);
    return rows.map((v) => new ResumeVersionResponse(v));
  }

  @Get('diff')
  @ApiOperation({
    summary: 'Word-level diff between two versions of a resume',
  })
  @ApiErrorResponses({
    404: 'No resume with that id belongs to the current user, or a version was not found.',
  })
  async diff(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('from', ParseIntPipe) from: number,
    @Query('to', ParseIntPipe) to: number,
  ) {
    return this.versions.diff(id, user.id, from, to);
  }

  @Post(':version/restore')
  @ApiOperation({
    summary: 'Restore an earlier version',
    description:
      'Copies the target version FORWARD as a new version — history is never rewritten, ' +
      'so you can always come back.',
  })
  @ApiErrorResponses({
    404: 'No resume with that id belongs to the current user, or that version was not found.',
  })
  async restore(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('version', ParseIntPipe) version: number,
  ) {
    return this.versions.restore(id, user.id, version);
  }
}
