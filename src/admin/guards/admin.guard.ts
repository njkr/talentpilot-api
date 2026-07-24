import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Env } from '../../config/config.module';
import { User } from '../../auth/entities/user.entity';

/**
 * Double gate, deliberately: role='admin' alone is not enough. A bug in role
 * assignment, or a compromised admin account, would otherwise open every /admin
 * route. ADMIN_ALLOWED_EMAILS is an env-controlled allowlist that only ops can
 * change — an attacker needs BOTH a role='admin' row AND a spot on that list.
 *
 * Runs after the global JwtAuthGuard (req.user is already populated by then), so this
 * only needs to check authorization, not authentication.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly env: Env) {}

  canActivate(ctx: ExecutionContext): boolean {
    const user = ctx.switchToHttp().getRequest().user as User | undefined;
    if (!user || user.role !== 'admin') {
      throw new ForbiddenException('Admin access required.');
    }

    const allowlist = this.env
      .get('ADMIN_ALLOWED_EMAILS')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    if (!allowlist.includes(user.email.toLowerCase())) {
      throw new ForbiddenException('Admin access required.');
    }

    return true;
  }
}
