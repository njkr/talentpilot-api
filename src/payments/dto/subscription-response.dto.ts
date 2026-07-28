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
  @ApiProperty({
    description:
      'true → currentPeriodEnd is when access ENDS (dropping to free). false → currentPeriodEnd is when the plan RENEWS. The FE picks the label from this field, not a separate one.',
  })
  cancelAtPeriodEnd: boolean;
  @ApiProperty({
    nullable: true,
    description:
      'Set only when a DOWNGRADE is scheduled for the next renewal (see POST /payments/subscription/switch) — planKey is still the current (higher) plan until then. An upgrade never sets this; it applies to planKey immediately.',
  })
  pendingPlanKey: PlanKey | null;

  constructor(plan: Plan | null, sub: Subscription | null) {
    Object.assign(this, {
      planKey: plan?.key ?? 'free',
      planName: plan?.name ?? 'Free',
      monthlyCredits: plan?.monthlyCredits ?? 0,
      maxResumes: plan?.limits?.maxResumes ?? 3,
      maxWorkspaces: plan?.limits?.maxWorkspaces ?? 3,
      status: sub?.status ?? 'active',
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
      pendingPlanKey: sub?.pendingPlanKey ?? null,
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
