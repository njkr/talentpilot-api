import { Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from 'src/auth/decorators/public.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { User } from 'src/auth/entities/user.entity';
import {
  ApiDataResponse,
  ApiErrorResponses,
} from 'src/common/swagger/api-response.decorator';
import { CreditPack } from './entities/credit-pack.entity';
import { CreditPacksService } from './credit-packs.service';
import { CreditPackResponse } from './dto/credit-pack-response.dto';
import { CheckoutSessionResponse } from './dto/subscription-response.dto';

@ApiTags('credit-packs')
@Controller('credit-packs')
export class CreditPacksController {
  constructor(
    @InjectRepository(CreditPack)
    private readonly packs: Repository<CreditPack>,
    private readonly creditPacks: CreditPacksService,
  ) {}

  @Get()
  @Public() // same reasoning as PlansController — visible before signup
  @ApiOperation({ summary: 'List active one-time credit packs' })
  @ApiDataResponse(200, CreditPackResponse, 'Active packs only.', {
    isArray: true,
  })
  async list() {
    const packs = await this.packs.find({
      where: { active: true },
      order: { displayOrder: 'ASC' },
    });
    return packs.map((p) => new CreditPackResponse(p));
  }

  @Post(':id/checkout')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Start a Stripe Checkout session to buy a one-time credit pack',
    description:
      'Requires a unique `Idempotency-Key` header, same pattern as ' +
      '`POST /payments/checkout`. `mode: payment`, not a subscription.',
  })
  @ApiDataResponse(
    201,
    CheckoutSessionResponse,
    'Redirect the browser to `url`.',
  )
  @ApiErrorResponses({
    400: 'Missing Idempotency-Key header.',
    403: 'FEATURE_DISABLED — credit packs are turned off in payment_config.',
    404: 'Credit pack not found, or not active.',
  })
  async checkout(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    const { url } = await this.creditPacks.createCheckout(
      user.id,
      user.email,
      id,
      idempotencyKey,
    );
    return new CheckoutSessionResponse(url);
  }
}
