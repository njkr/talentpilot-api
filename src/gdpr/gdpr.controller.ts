import { Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { User } from 'src/auth/entities/user.entity';
import { ApiNoContentResponse } from 'src/common/swagger/api-response.decorator';
import { GdprService } from './gdpr.service';

@ApiTags('gdpr')
@ApiBearerAuth('access-token')
@Controller('gdpr')
export class GdprController {
  constructor(private readonly gdpr: GdprService) {}

  @Post('export')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Request a full export of your data (GDPR)',
    description:
      "Queued, not synchronous — you'll get an in-app + email notification with a " +
      'download link once the export is ready.',
  })
  @ApiNoContentResponse(202, 'Export queued.')
  async requestExport(@CurrentUser() user: User) {
    await this.gdpr.requestExport(user.id);
  }
}
