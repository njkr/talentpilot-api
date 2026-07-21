import { Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { User } from 'src/auth/entities/user.entity';
import {
  ApiDataResponse,
  ApiErrorResponses,
} from 'src/common/swagger/api-response.decorator';
import { MatchingService } from './matching.service';
import { MatchResponse } from './dto/match-response.dto';

@ApiTags('matching')
@ApiBearerAuth('access-token')
@Controller('resumes/:resumeId/match/:jdId')
export class MatchingController {
  constructor(private readonly matching: MatchingService) {}

  @Post()
  @ApiOperation({
    summary: 'Score a resume against a job description',
    description:
      'Embeds both sides (skipping any chunk whose content is unchanged since the last ' +
      'call — free on a re-run), then returns a calibrated 0-100 semantic score per ' +
      'requirement plus a keyword coverage report.',
  })
  @ApiDataResponse(201, MatchResponse, 'Match computed.')
  @ApiErrorResponses({
    404: 'No resume or job description with that id belongs to the current user.',
    409: 'Resume is not yet `parsed`, or the job description is not yet `analyzed`.',
  })
  async match(
    @CurrentUser() user: User,
    @Param('resumeId', ParseUUIDPipe) resumeId: string,
    @Param('jdId', ParseUUIDPipe) jdId: string,
  ) {
    return new MatchResponse(
      await this.matching.match(resumeId, jdId, user.id),
    );
  }
}
