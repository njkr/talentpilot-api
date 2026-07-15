import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { User } from '../entities/user.entity';
import { Problems } from 'src/common/problems';

@Injectable()
export class VerifiedGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const user: User = ctx.switchToHttp().getRequest().user;
    if (!user?.isVerified) throw Problems.emailNotVerified();
    return true;
  }
}
