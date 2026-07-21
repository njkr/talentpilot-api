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
import { InterviewService } from './interview.service';
import { InterviewQuestionResponse } from './dto/interview-question-response.dto';
import { SubmitAnswerDto } from './dto/submit-answer.dto';

@ApiTags('interview')
@ApiBearerAuth('access-token')
@Controller()
export class InterviewController {
  constructor(private readonly interview: InterviewService) {}

  @Get('workspaces/:id/interview-questions')
  @ApiOperation({
    summary: 'List generated interview questions for a workspace',
  })
  @ApiDataResponse(200, InterviewQuestionResponse, 'Interview questions.', {
    isArray: true,
  })
  @ApiErrorResponses({
    404: 'No workspace with that id belongs to the current user.',
  })
  async list(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const rows = await this.interview.listForWorkspace(id, user.id);
    return rows.map((q) => new InterviewQuestionResponse(q));
  }

  @Post('interview-questions/:id/answer')
  @ApiOperation({
    summary: 'Submit a practice answer and get AI feedback',
    description: 'Costs 1 credit per attempt.',
  })
  @ApiDataResponse(
    200,
    InterviewQuestionResponse,
    'Scored answer with feedback.',
  )
  @ApiErrorResponses({
    402: 'Insufficient credits (INSUFFICIENT_CREDITS).',
    404: 'No question with that id belongs to the current user.',
  })
  async answer(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitAnswerDto,
  ) {
    return new InterviewQuestionResponse(
      await this.interview.submitAnswer(id, user.id, dto.answer),
    );
  }
}
