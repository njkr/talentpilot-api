import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { User } from 'src/auth/entities/user.entity';
import { ApiErrorResponses } from 'src/common/swagger/api-response.decorator';
import { SalaryService } from './salary.service';

@ApiTags('salary')
@ApiBearerAuth('access-token')
@Controller('workspaces/:id/salary-estimate')
export class SalaryController {
  constructor(private readonly salary: SalaryService) {}

  @Get()
  @ApiOperation({
    summary: 'Get the salary estimate for a workspace',
    description:
      'Always a range (p25/p50/p75) with `isEstimate: true` — never presented as a quote.',
  })
  @ApiErrorResponses({
    404: 'No workspace with that id belongs to the current user, or no estimate has been generated yet.',
  })
  async get(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.salary.getForWorkspace(id, user.id);
  }
}
