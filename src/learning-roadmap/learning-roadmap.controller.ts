import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { User } from 'src/auth/entities/user.entity';
import { ApiErrorResponses } from 'src/common/swagger/api-response.decorator';
import { LearningRoadmapService } from './learning-roadmap.service';

@ApiTags('learning-roadmap')
@ApiBearerAuth('access-token')
@Controller('workspaces/:id/learning-roadmap')
export class LearningRoadmapController {
  constructor(private readonly roadmap: LearningRoadmapService) {}

  @Get()
  @ApiOperation({
    summary: 'Get the skill-gap learning roadmap for a workspace',
    description:
      'At most 6 items, ordered by priority — see build_learning_path.',
  })
  @ApiErrorResponses({
    404: 'No workspace with that id belongs to the current user, or no roadmap has been generated yet.',
  })
  async get(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.roadmap.getForWorkspace(id, user.id);
  }
}
