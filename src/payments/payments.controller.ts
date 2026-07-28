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
import { SwitchPlanDto } from './dto/switch-plan.dto';
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
      dto.interval,
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

  @Post('subscription/cancel')
  @HttpCode(200)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Schedule cancellation at the end of the current billing period',
    description:
      'Never cancels immediately — you keep your plan and its benefits until ' +
      '`currentPeriodEnd`, then drop to free. An immediate cancel is a refund ' +
      'question, not a cancel one.',
  })
  @ApiDataResponse(200, SubscriptionResponse, 'cancelAtPeriodEnd is now true.')
  @ApiErrorResponses({
    404: 'NO_ACTIVE_SUBSCRIPTION — you have no paid subscription to cancel.',
  })
  async cancel(@CurrentUser() user: User) {
    await this.payments.cancelSubscription(user.id);
    const { plan, subscription } = await this.payments.getSubscription(user.id);
    return new SubscriptionResponse(plan, subscription);
  }

  @Post('subscription/resume')
  @HttpCode(200)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Undo a scheduled cancellation',
    description: 'A one-call undo — no need to re-subscribe.',
  })
  @ApiDataResponse(200, SubscriptionResponse, 'cancelAtPeriodEnd is now false.')
  @ApiErrorResponses({
    404: 'NO_SUBSCRIPTION_TO_RESUME — no scheduled cancellation exists.',
  })
  async resume(@CurrentUser() user: User) {
    await this.payments.resumeSubscription(user.id);
    const { plan, subscription } = await this.payments.getSubscription(user.id);
    return new SubscriptionResponse(plan, subscription);
  }

  @Post('subscription/switch')
  @HttpCode(200)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Switch an EXISTING subscription to a different plan',
    description:
      'For subscribers only — use this, never `/checkout`, to change plans ' +
      '(checkout on an already-subscribed user 409s with ALREADY_SUBSCRIBED). ' +
      'Upgrades apply immediately (prorated charge now, credit-gap granted now). ' +
      'Downgrades are scheduled for the next renewal — you keep your current ' +
      "plan's benefits until then; `pendingPlanKey` shows what's coming.",
  })
  @ApiDataResponse(
    200,
    SubscriptionResponse,
    'planKey (upgrade) or pendingPlanKey (downgrade) reflects the switch.',
  )
  @ApiErrorResponses({
    404: 'NO_ACTIVE_SUBSCRIPTION, or PLAN_NOT_PURCHASABLE for that plan/interval.',
    409:
      'ALREADY_SUBSCRIBED — already on the requested plan with nothing pending. ' +
      '(Switching to the CURRENT plan while a downgrade IS pending is not an error — ' +
      "it's treated as clear-pending-change and undoes the downgrade instead.)",
  })
  async switch(@CurrentUser() user: User, @Body() dto: SwitchPlanDto) {
    await this.payments.switchPlan(user.id, dto.planKey, dto.interval);
    const { plan, subscription } = await this.payments.getSubscription(user.id);
    return new SubscriptionResponse(plan, subscription);
  }

  @Post('subscription/clear-pending-change')
  @HttpCode(200)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Cancel a pending plan change (undo a scheduled downgrade)',
    description:
      'Releases the Stripe Subscription Schedule behind a pending downgrade and ' +
      'returns to steady state on the current plan — the explicit path for "I changed ' +
      'my mind about downgrading." Equivalent to calling Switch Plan with the plan ' +
      "you're already on while a downgrade is pending.",
  })
  @ApiDataResponse(200, SubscriptionResponse, 'pendingPlanKey is now null.')
  @ApiErrorResponses({
    404: 'NO_ACTIVE_SUBSCRIPTION, or NO_SUBSCRIPTION_TO_RESUME if there is no pending plan change to cancel.',
  })
  async clearPendingChange(@CurrentUser() user: User) {
    await this.payments.clearPendingChange(user.id);
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
