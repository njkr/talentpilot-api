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
import { CoverLetterService } from './cover-letter.service';
import { CoverLetterResponse } from './dto/cover-letter-response.dto';
import { RegenerateCoverLetterDto } from './dto/regenerate-cover-letter.dto';

@ApiTags('cover-letter')
@ApiBearerAuth('access-token')
@Controller('workspaces/:id/cover-letter')
export class CoverLetterController {
  constructor(private readonly coverLetters: CoverLetterService) {}

  @Get()
  @ApiOperation({ summary: 'Get the current cover letter for a workspace' })
  @ApiDataResponse(200, CoverLetterResponse, 'The current cover letter.')
  @ApiErrorResponses({
    404: 'No workspace with that id belongs to the current user, or none has been generated yet.',
  })
  async getCurrent(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return new CoverLetterResponse(
      await this.coverLetters.getCurrent(id, user.id),
    );
  }

  @Post('regenerate')
  @ApiOperation({
    summary: 'Regenerate the cover letter with a different tone/length',
    description:
      'Costs 2 credits and supersedes the previous version as the current one — the ' +
      'old version stays in place for reference but `isCurrent` moves to the new one.',
  })
  @ApiDataResponse(201, CoverLetterResponse, 'The new cover letter.')
  @ApiErrorResponses({
    402: 'Insufficient credits (INSUFFICIENT_CREDITS).',
    404: 'No workspace with that id belongs to the current user.',
    502: 'The generated letter failed validation (AI_OUTPUT_INVALID) — retry.',
  })
  async regenerate(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RegenerateCoverLetterDto,
  ) {
    return new CoverLetterResponse(
      await this.coverLetters.regenerateForWorkspace(id, user.id, dto),
    );
  }
}
