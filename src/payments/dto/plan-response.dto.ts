import { ApiProperty } from '@nestjs/swagger';
import { Plan } from '../entities/plan.entity';

// Public-facing — deliberately omits stripeProductId/stripePriceIds (internal Stripe
// refs the FE has no use for and shouldn't see) while exposing everything a pricing
// page needs.
export class PlanResponse {
  @ApiProperty() id: string;
  @ApiProperty() key: string;
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true }) description: string | null;
  @ApiProperty() priceMonthlyCents: number;
  @ApiProperty() priceYearlyCents: number;
  @ApiProperty() monthlyCredits: number;
  @ApiProperty() maxResumes: number;
  @ApiProperty() maxWorkspaces: number;
  @ApiProperty() displayOrder: number;

  constructor(plan: Plan) {
    Object.assign(this, {
      id: plan.id,
      key: plan.key,
      name: plan.name,
      description: plan.description,
      priceMonthlyCents: plan.priceMonthlyCents,
      priceYearlyCents: plan.priceYearlyCents,
      monthlyCredits: plan.monthlyCredits,
      maxResumes: plan.limits.maxResumes,
      maxWorkspaces: plan.limits.maxWorkspaces,
      displayOrder: plan.displayOrder,
    });
  }
}
