import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Resume } from 'src/resumes/entities/resume.entity';
import { Workspace } from 'src/workspaces/entities/workspace.entity';
import { Plan, PlanKey } from 'src/payments/entities/plan.entity';
import { Subscription } from 'src/payments/entities/subscription.entity';
import { Problems } from 'src/common/problems';

// Fallback if the `plans` table hasn't been seeded in some environment (fresh DB,
// migration not yet run) — matches the numbers the Sprint 2 stub originally hardcoded,
// so a missing seed degrades to the old behaviour rather than crashing every request.
const FREE_PLAN_FALLBACK: Pick<Plan, 'key' | 'maxResumes' | 'maxWorkspaces'> = {
  key: 'free',
  maxResumes: 3,
  maxWorkspaces: 3,
};

/**
 * Sprint 10: replaces the Sprint 2 stub's hardcoded PLAN_LIMITS object with a real
 * lookup against the user's Subscription row + the Plan table it points at. The
 * public interface (assertCanCreateResume) is unchanged — everything that already
 * called it keeps working with no changes on their end.
 */
@Injectable()
export class PlanLimitService {
  constructor(
    @InjectRepository(Resume) private readonly resumes: Repository<Resume>,
    @InjectRepository(Workspace)
    private readonly workspaces: Repository<Workspace>,
    @InjectRepository(Subscription)
    private readonly subscriptions: Repository<Subscription>,
    @InjectRepository(Plan) private readonly plans: Repository<Plan>,
  ) {}

  async assertCanCreateResume(userId: string): Promise<void> {
    const plan = await this.planFor(userId);
    if (plan.maxResumes === -1) return;

    const current = await this.resumes.count({ where: { userId } });
    if (current >= plan.maxResumes) {
      throw Problems.planLimitReached('resumes', plan.maxResumes, current);
    }
  }

  async assertCanCreateWorkspace(userId: string): Promise<void> {
    const plan = await this.planFor(userId);
    if (plan.maxWorkspaces === -1) return;

    const current = await this.workspaces.count({ where: { userId } });
    if (current >= plan.maxWorkspaces) {
      throw Problems.planLimitReached(
        'workspaces',
        plan.maxWorkspaces,
        current,
      );
    }
  }

  /**
   * A subscription row only exists once a user has started a paid checkout (see
   * Subscription entity doc comment) — no row, or a canceled one, means free. A
   * `past_due` subscription still counts as its paid plan: Stripe gives customers a
   * grace period to update their card before the plan actually lapses, and
   * PaymentsService flips it to 'canceled' itself once that grace period ends.
   */
  private async planFor(
    userId: string,
  ): Promise<Plan | typeof FREE_PLAN_FALLBACK> {
    const sub = await this.subscriptions.findOne({ where: { userId } });
    const key: PlanKey =
      sub && (sub.status === 'active' || sub.status === 'past_due')
        ? sub.planKey
        : 'free';

    const plan = await this.plans.findOne({ where: { key } });
    return plan ?? FREE_PLAN_FALLBACK;
  }
}
