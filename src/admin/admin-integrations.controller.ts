import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from './guards/admin.guard';
import {
  AdminIntegrationsService,
  IntegrationProviderName,
} from './admin-integrations.service';

function assertProviderName(
  name: string,
): asserts name is IntegrationProviderName {
  if (
    !(AdminIntegrationsService.PROVIDERS as readonly string[]).includes(name)
  ) {
    throw new BadRequestException(
      `Unknown provider "${name}". Valid: ${AdminIntegrationsService.PROVIDERS.join(', ')}`,
    );
  }
}

// Read-only — no audit logging, same precedent as AdminController's /costs endpoint.
@ApiTags('admin')
@ApiBearerAuth('access-token')
@UseGuards(AdminGuard)
@Controller('admin/integrations')
export class AdminIntegrationsController {
  constructor(private readonly integrations: AdminIntegrationsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Last-24h call/error counts for every third-party integration (openai, resend, tavily, stripe, s3)',
  })
  async overview() {
    return this.integrations.overview();
  }

  @Get(':provider/daily')
  @ApiOperation({
    summary: 'Daily call/error history for one integration provider',
  })
  async dailyHistory(
    @Param('provider') provider: string,
    @Query('days') days?: string,
  ) {
    assertProviderName(provider);
    return this.integrations.dailyHistory(
      provider,
      days ? Number(days) : undefined,
    );
  }
}
