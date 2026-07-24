import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Resume } from '../resumes/entities/resume.entity';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { Plan } from '../payments/entities/plan.entity';
import { Subscription } from '../payments/entities/subscription.entity';
import { PlanLimitService } from './plan-limit.service';

/**
 * Small on purpose: PlanLimitService is a pure read-side query against Plan/
 * Subscription (owned by PaymentsModule) plus Resume/Workspace counts — no writes,
 * no controller. Kept as its own module (rather than folded into PaymentsModule) so
 * ResumesModule/WorkspacesModule can depend on just this without pulling in Stripe,
 * the `emails` queue, or the webhook controller.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Resume, Workspace, Plan, Subscription])],
  providers: [PlanLimitService],
  exports: [PlanLimitService],
})
export class SubscriptionsModule {}
