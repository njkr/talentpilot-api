import { ApiProperty } from '@nestjs/swagger';
import { Plan, PlanKey } from '../entities/plan.entity';
import {
  Subscription,
  SubscriptionStatus,
} from '../entities/subscription.entity';

export class SubscriptionResponse {
  @ApiProperty() planKey: PlanKey;
  @ApiProperty() planName: string;
  @ApiProperty() monthlyCredits: number;
  @ApiProperty() maxResumes: number;
  @ApiProperty() maxWorkspaces: number;
  @ApiProperty() status: SubscriptionStatus;
  @ApiProperty({
    required: false,
    nullable: true,
    type: String,
    format: 'date-time',
  })
  currentPeriodEnd: Date | null;
  @ApiProperty() cancelAtPeriodEnd: boolean;

  constructor(plan: Plan | null, sub: Subscription | null) {
    Object.assign(this, {
      planKey: plan?.key ?? 'free',
      planName: plan?.name ?? 'Free',
      monthlyCredits: plan?.monthlyCredits ?? 0,
      maxResumes: plan?.maxResumes ?? 3,
      maxWorkspaces: plan?.maxWorkspaces ?? 3,
      status: sub?.status ?? 'active',
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
    });
  }
}

export class CheckoutSessionResponse {
  @ApiProperty() url: string;
  constructor(url: string) {
    this.url = url;
  }
}

export class PortalSessionResponse {
  @ApiProperty() url: string;
  constructor(url: string) {
    this.url = url;
  }
}
