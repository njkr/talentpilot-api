import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { TokenExpiredError } from 'jsonwebtoken';
import { Problems } from '../../common/problems';

// Global JWT guard: everything is protected unless marked @Public().
// Opt-OUT is the only safe default — opt-IN means one forgotten @UseGuards() = an open endpoint.
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') implements CanActivate {
  constructor(private reflector: Reflector) {
    super();
  }
  canActivate(ctx: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    return isPublic ? true : super.canActivate(ctx);
  }

  // Without this override, EVERY jwt failure — expired, malformed, wrong signature —
  // falls through to @nestjs/passport's default handleRequest, which ignores `info`
  // entirely and throws a bare UnauthorizedException. AllExceptionsFilter then maps
  // that generic exception to TOKEN_INVALID unconditionally (see its own
  // `instanceof UnauthorizedException` branch) — so today, system-wide, an expired
  // access token is indistinguishable from a genuinely invalid one on every single
  // protected endpoint, not just this one. `info` is a TokenExpiredError specifically
  // when passport-jwt's own jwt.verify() rejected the token for expiry (checked
  // before JwtStrategy.validate() ever runs), which is the one case this guard can
  // still tell apart from the rest at this layer.
  handleRequest<TUser = unknown>(err: any, user: any, info: any): TUser {
    if (info instanceof TokenExpiredError) {
      throw Problems.tokenExpired();
    }
    if (err || !user) {
      throw err instanceof Error ? err : Problems.refreshInvalid();
    }
    return user;
  }
}
