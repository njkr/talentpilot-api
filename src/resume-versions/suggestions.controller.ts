import {
  Body,
  Controller,
  Get,
  Param,
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
import { SuggestionResponse } from './dto/suggestion-response.dto';
import { SuggestionIdsDto } from './dto/suggestion-ids.dto';
import { ProvideSuggestionDetailDto } from './dto/provide-suggestion-detail.dto';

/**
 * Read/apply/reject already-generated suggestions — no AI call happens here.
 * Generating them (SuggestionsService.generate, worker-only) happens inside
 * OptimizeResumeStep during the pipeline run.
 */
@ApiTags('suggestions')
@ApiBearerAuth('access-token')
@Controller('workspaces/:id/suggestions')
export class SuggestionsController {
  constructor(private readonly versions: ResumeVersionsService) {}

  @Get()
  @ApiOperation({ summary: 'List AI suggestions for a workspace' })
  @ApiDataResponse(200, SuggestionResponse, 'Suggestions.', { isArray: true })
  @ApiErrorResponses({
    404: 'No workspace with that id belongs to the current user.',
  })
  async list(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('status')
    status?: 'pending' | 'accepted' | 'rejected' | 'stale' | 'needs_info',
  ) {
    const rows = await this.versions.listSuggestions(
      id,
      user.id,
      status ?? 'pending',
    );
    return rows.map((s) => new SuggestionResponse(s));
  }

  @Post('apply')
  @ApiOperation({
    summary: 'Accept a batch of suggestions, creating one new resume version',
    description:
      'A suggestion is refused (marked `stale`) if the underlying bullet was hand-' +
      'edited since the suggestion was generated — the edit always wins.',
  })
  @ApiErrorResponses({
    404: 'No workspace with that id belongs to the current user.',
  })
  async apply(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuggestionIdsDto,
  ) {
    return this.versions.applyForWorkspace(id, user.id, dto.suggestionIds);
  }

  @Post('reject')
  @ApiOperation({
    summary: 'Dismiss a batch of suggestions without applying them',
  })
  @ApiErrorResponses({
    404: 'No workspace with that id belongs to the current user.',
  })
  async reject(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuggestionIdsDto,
  ) {
    const count = await this.versions.rejectSuggestions(
      id,
      user.id,
      dto.suggestionIds,
    );
    return { rejected: count };
  }

  @Post(':suggestionId/provide-detail')
  @ApiOperation({
    summary:
      'Supply your own real text for a "needs_info" suggestion, replacing its ' +
      'illustrative example',
    description:
      'Re-runs the same fabrication check on your submitted text. If it passes, the ' +
      'suggestion becomes a normal `pending` suggestion; if it still asserts an ' +
      'ungrounded fact, it stays `needs_info` with updated guidance.',
  })
  @ApiDataResponse(200, SuggestionResponse, 'The updated suggestion.')
  @ApiErrorResponses({
    404: 'No workspace with that id belongs to the current user, or no needs_info suggestion with that id.',
  })
  async provideDetail(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('suggestionId', ParseUUIDPipe) suggestionId: string,
    @Body() dto: ProvideSuggestionDetailDto,
  ) {
    const suggestion = await this.versions.provideDetail(
      id,
      user.id,
      suggestionId,
      dto.newText,
    );
    return new SuggestionResponse(suggestion);
  }
}
