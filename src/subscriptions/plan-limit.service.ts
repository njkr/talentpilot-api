import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Resume } from 'src/resumes/entities/resume.entity';
import { Problems } from 'src/common/problems';

/**
 * Sprint 2 stub. A later sprint replaces PLAN_LIMITS with a lookup against a
 * `plans` table and the user's real subscription. The interface stays
 * identical so nothing else changes.
 */
const PLAN_LIMITS = {
  free: { maxResumes: 3, maxWorkspaces: 3 },
  pro: { maxResumes: 25, maxWorkspaces: 100 },
  ultimate: { maxResumes: -1, maxWorkspaces: -1 }, // -1 = unlimited
} as const;

@Injectable()
export class PlanLimitService {
  constructor(
    @InjectRepository(Resume) private readonly resumes: Repository<Resume>,
  ) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private planFor(userId: string): keyof typeof PLAN_LIMITS {
    return 'free'; // later sprint: read the user's actual subscription
  }

  async assertCanCreateResume(userId: string) {
    const limit = PLAN_LIMITS[this.planFor(userId)].maxResumes;
    if (limit === -1) return;

    // Soft-deleted rows don't count — deleting a resume should genuinely free a slot.
    const current = await this.resumes.count({ where: { userId } });
    if (current >= limit)
      throw Problems.planLimitReached('resumes', limit, current);
  }
}
