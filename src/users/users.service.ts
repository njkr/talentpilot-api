import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from 'src/auth/entities/user.entity';
import { TokenService } from 'src/auth/services/token.service';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly tokens: TokenService,
  ) {}

  async update(userId: string, dto: UpdateUserDto): Promise<User> {
    // UpdateUserDto has no fields yet (see its own comment) — an empty partial
    // would make TypeORM throw ("update values are not defined"), so skip the
    // write entirely until there's something real to persist.
    if (Object.keys(dto).length > 0) {
      await this.users.update(userId, dto as Partial<User>);
    }
    return this.users.findOneOrFail({ where: { id: userId } });
  }

  /**
   * GDPR delete. This is a SOFT delete — it sets the `deletedAt` column (via the
   * @DeleteDateColumn on the User entity), so the row still exists but is auto-excluded
   * from every normal query. We do NOT hard-delete here because:
   *   1. workspaces, resumes, payments reference this user — a hard delete would either
   *      cascade-destroy financial records or throw a foreign-key error;
   *   2. the user gets a 30-day grace window to change their mind.
   * The actual purge (hard delete of rows + S3 files + Stripe detach) is a scheduled job
   * for a later sprint. Here we just mark, revoke every session, and soft-delete.
   */
  async softDelete(userId: string): Promise<void> {
    await this.users.update(userId, { status: 'deleted' }); // blocks login immediately
    await this.tokens.revokeAllForUser(userId, 'account_deleted'); // a live token can't act on a deleted account
    await this.users.softDelete(userId); // sets deletedAt
  }
}
