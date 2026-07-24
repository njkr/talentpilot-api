import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { Public } from 'src/auth/decorators/public.decorator';
import { RawResponse } from 'src/common/decorators/raw-response.decorator';
import { User } from 'src/auth/entities/user.entity';
import {
  ApiDataResponse,
  ApiErrorResponses,
} from 'src/common/swagger/api-response.decorator';
import { PaymentsService } from './payments.service';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import {
  CheckoutSessionResponse,
  PortalSessionResponse,
  SubscriptionResponse,
} from './dto/subscription-response.dto';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('checkout')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Start a Stripe Checkout session for a paid plan',
    description:
      'Requires a unique `Idempotency-Key` header — replaying the same key returns ' +
      'the same Checkout session instead of creating a second one, same pattern as ' +
      '`POST /workspaces/:id/analyze`.',
  })
  @ApiDataResponse(
    201,
    CheckoutSessionResponse,
    'Redirect the browser to `url`.',
  )
  @ApiErrorResponses({
    400: 'Missing Idempotency-Key header.',
    404: 'Plan not available for checkout in this environment.',
  })
  async checkout(
    @CurrentUser() user: User,
    @Body() dto: CreateCheckoutDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    const { url } = await this.payments.createCheckoutSession(
      user.id,
      dto.planKey,
      idempotencyKey,
    );
    return new CheckoutSessionResponse(url);
  }

  @Post('portal')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary:
      'Create a Stripe billing portal session (manage/cancel subscription, update card)',
  })
  @ApiDataResponse(201, PortalSessionResponse, 'Redirect the browser to `url`.')
  @ApiErrorResponses({
    404: 'No billing account on file — user is on the free plan.',
  })
  async portal(@CurrentUser() user: User) {
    const { url } = await this.payments.createPortalSession(user.id);
    return new PortalSessionResponse(url);
  }

  @Get('subscription')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: "Get the current user's plan and subscription status",
  })
  @ApiDataResponse(
    200,
    SubscriptionResponse,
    'Free plan if no subscription exists.',
  )
  async getSubscription(@CurrentUser() user: User) {
    const { plan, subscription } = await this.payments.getSubscription(user.id);
    return new SubscriptionResponse(plan, subscription);
  }

  // Public: Stripe calls this directly, with no bearer token — signature verification
  // (inside PaymentsService.handleWebhook) IS the authentication for this route.
  @Post('webhook')
  @Public()
  @RawResponse()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Stripe webhook receiver (signature-verified, not bearer-authed)',
  })
  @ApiErrorResponses({
    400: 'WEBHOOK_SIGNATURE_INVALID — bad or missing stripe-signature header.',
  })
  async webhook(
    @Req() req: Request,
    @Headers('stripe-signature') signature?: string,
  ) {
    if (!signature)
      throw new BadRequestException('Missing stripe-signature header.');
    // req.body is a raw Buffer here, not a parsed object — see main.ts's express.raw()
    // carve-out registered specifically for this path, ahead of the global JSON parser.
    await this.payments.handleWebhook(req.body as Buffer, signature);
    return { received: true };
  }
}
