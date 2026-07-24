import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { User } from 'src/auth/entities/user.entity';
import { ApiDataResponse } from 'src/common/swagger/api-response.decorator';
import { DashboardService } from './dashboard.service';
import { DashboardOverviewResponse } from './dto/dashboard-overview.dto';

@ApiTags('dashboard')
@ApiBearerAuth('access-token')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @ApiOperation({ summary: "The authenticated user's dashboard overview" })
  @ApiDataResponse(
    200,
    DashboardOverviewResponse,
    'Cached briefly (30s) per user.',
  )
  async getOverview(@CurrentUser() user: User) {
    return this.dashboard.getOverview(user.id);
  }
}
