import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CursorQueryDto } from 'src/common/dto/cursor-query.dto';
import { AdminGuard } from './guards/admin.guard';
import { ReferralsService } from '../referrals/referrals.service';

@ApiTags('admin')
@ApiBearerAuth('access-token')
@UseGuards(AdminGuard)
@Controller('admin/referrals')
export class AdminReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get()
  @ApiOperation({ summary: 'Every referral, newest first (cursor-paginated)' })
  list(@Query() q: CursorQueryDto) {
    return this.referrals.adminList(q);
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Global referral totals — invited, qualified, credits paid out',
  })
  stats() {
    return this.referrals.globalStats();
  }
}
