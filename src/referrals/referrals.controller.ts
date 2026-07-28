import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { User } from 'src/auth/entities/user.entity';
import { Env } from 'src/config/config.module';
import { ApiDataResponse } from 'src/common/swagger/api-response.decorator';
import { ReferralsService } from './referrals.service';
import { PaymentConfigService } from '../payments/config/payment-config.service';
import { ReferralMeResponse } from './dto/referral-me-response.dto';

@ApiTags('referrals')
@ApiBearerAuth('access-token')
@Controller('referrals')
export class ReferralsController {
  constructor(
    private readonly referrals: ReferralsService,
    private readonly config: PaymentConfigService,
    private readonly env: Env,
  ) {}

  @Get('me')
  @ApiOperation({
    summary: "The current user's referral code, share link, and stats",
  })
  @ApiDataResponse(
    200,
    ReferralMeResponse,
    'Always returns a code — generated lazily on first request.',
  )
  async myReferral(@CurrentUser() user: User): Promise<ReferralMeResponse> {
    const config = await this.config.get();
    const code = await this.referrals.getMyCode(user.id);
    return {
      code,
      shareUrl: `${this.env.get('APP_URL')}/register?ref=${code}`,
      rewardPerReferral: config.referrerReward,
      enabled: config.referralsEnabled,
      stats: await this.referrals.statsFor(user.id),
    };
  }
}
