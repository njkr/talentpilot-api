import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Profile } from './entities/profile.entity';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class ProfilesService {
  constructor(
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
  ) {}

  /**
   * UPSERT, not update. A user may never have had a profile row, and forcing the frontend
   * to know whether to POST or PATCH is needless complexity. `onConflict` does it in one
   * statement — no read-then-write race where two parallel PUTs both try to insert.
   */
  async upsert(userId: string, dto: UpdateProfileDto): Promise<Profile> {
    await this.profiles.upsert(
      { userId, ...dto },
      { conflictPaths: ['userId'], skipUpdateIfNoValuesChanged: true },
    );
    return this.profiles.findOneOrFail({ where: { userId } });
  }

  async get(userId: string): Promise<Profile> {
    const existing = await this.profiles.findOne({ where: { userId } });
    if (existing) return existing;

    // Return an empty shell rather than 404 — the frontend's settings form always has
    // something to bind to, and "no profile yet" isn't an error condition. Every
    // nullable column is set explicitly to `null`: repo.create({ userId }) alone leaves
    // them `undefined`, and JSON.stringify silently DROPS undefined keys (unlike null),
    // so the response would be missing fields instead of returning them as null.
    return this.profiles.create({
      userId,
      firstName: null,
      lastName: null,
      phone: null,
      linkedin: null,
      github: null,
      portfolio: null,
      country: null,
      city: null,
      timezone: null,
      yearsExperience: null,
      targetRole: null,
      salaryExpectation: null,
      salaryCurrency: null,
    });
  }

  /** Completeness drives the "finish your profile" nudge and better AI output later. */
  completeness(p: Profile): number {
    const fields = [
      p.firstName,
      p.lastName,
      p.city,
      p.country,
      p.yearsExperience,
      p.targetRole,
      p.linkedin,
    ];
    return Math.round((fields.filter(Boolean).length / fields.length) * 100);
  }
}
