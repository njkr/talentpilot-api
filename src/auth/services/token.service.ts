import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { RefreshToken } from '../entities/refresh-token.entity';
import { Env } from 'src/config/config.module';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { User } from '../entities/user.entity';

export interface JwtPayload {
  sub: string; // user id
  role: 'user' | 'admin';
  ver: number; // tokenVersion — see below
  iat: number;
  exp: number;
}

/**
 * Refresh token wire format:  "<uuid>.<43-char base64url secret>"
 *
 * The uuid is the row id (O(1) lookup, no table scan of hashes).
 * The secret is 256 bits of entropy; we store only sha256(secret).
 * A stolen database therefore yields no usable refresh tokens.
 */
@Injectable()
export class TokenService {
  constructor(
    @InjectRepository(RefreshToken)
    private readonly repo: Repository<RefreshToken>,
    private readonly jwt: JwtService,
    private readonly env: Env,
  ) {}

  private sha256(s: string) {
    return createHash('sha256').update(s).digest('hex');
  }

  signAccess(user: Pick<User, 'id' | 'role' | 'tokenVersion'>) {
    return this.jwt.signAsync(
      { sub: user.id, role: user.role, ver: user.tokenVersion },
      {
        secret: this.env.get('JWT_ACCESS_SECRET'),
        expiresIn: this.env.get('JWT_ACCESS_TTL') as unknown as number,
      },
    );
  }

  /** Mints a refresh token. familyId omitted on fresh login (new family), passed on rotation. */
  async issueRefresh(
    userId: string,
    ctx: { ip?: string; userAgent?: string },
    familyId?: string,
    manager?: EntityManager,
  ): Promise<{ raw: string; entity: RefreshToken }> {
    const repo = manager ? manager.getRepository(RefreshToken) : this.repo;
    const secret = randomBytes(32).toString('base64url');
    const entity = repo.create({
      userId,
      familyId: familyId ?? randomUUID(),
      tokenHash: this.sha256(secret),
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent?.slice(0, 255) ?? null,
      expiresAt: new Date(
        Date.now() + this.env.get('REFRESH_TTL_DAYS') * 86_400_000,
      ),
    });
    await repo.save(entity);
    return { raw: `${entity.id}.${secret}`, entity };
  }

  async revokeFamily(
    familyId: string,
    reason: RefreshToken['revokedReason'],
    m?: EntityManager,
  ) {
    const repo = m ? m.getRepository(RefreshToken) : this.repo;
    await repo.update(
      { familyId, revokedAt: IsNull() },
      { revokedAt: new Date(), revokedReason: reason },
    );
  }

  async revokeAllForUser(
    userId: string,
    reason: RefreshToken['revokedReason'],
  ) {
    await this.repo.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date(), revokedReason: reason },
    );
  }
}
