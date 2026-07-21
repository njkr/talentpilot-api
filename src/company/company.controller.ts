import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { User } from 'src/auth/entities/user.entity';
import { ApiErrorResponses } from 'src/common/swagger/api-response.decorator';
import { CompanyService } from './company.service';

@ApiTags('company')
@ApiBearerAuth('access-token')
@Controller('workspaces/:id/company-insight')
export class CompanyController {
  constructor(private readonly company: CompanyService) {}

  @Get()
  @ApiOperation({
    summary: 'Get the company research for a workspace',
    description:
      'Always carries `sources` (URLs actually used) and `confidence` — "low" plus a ' +
      'thin overview means the company had little public information, not a bug.',
  })
  @ApiErrorResponses({
    404: 'No workspace with that id belongs to the current user, or research has not completed yet.',
  })
  async get(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.company.getForWorkspace(id, user.id);
  }
}
