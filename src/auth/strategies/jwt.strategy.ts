import { Injectable } from '@nestjs/common';
import { Problems } from 'src/common/problems';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    env: Env,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: env.get('JWT_ACCESS_SECRET'),
      ignoreExpiration: false,
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.users.findOne({ where: { id: payload.sub } });
    if (!user || user.status !== 'active') throw Problems.refreshInvalid();

    // The tokenVersion check. A password reset bumps the user's version, so a token
    // minted before the reset now mismatches → rejected immediately, not in 15 minutes.
    if (payload.ver !== user.tokenVersion) throw Problems.refreshInvalid();

    return user; // → req.user
  }
}
