import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';
import { ReqCtx } from '../common/interfaces/req-ctx.interface';
import { CursorQueryDto } from '../common/dto/cursor-query.dto';
import { decodeCursor, encodeCursor } from '../common/utils/cursor.util';

export interface AuditLogInput {
  userId: string | null;
  actorType: 'user' | 'system' | 'admin';
  action: string;
  resourceType: string;
  resourceId?: string | null;
  ctx?: ReqCtx;
  metadata?: Record<string, unknown>;
}

export interface AuditListFilter {
  userId?: string;
  action?: string;
  resourceType?: string;
}

/**
 * Generalises the write pattern AuthListener already used inline (log(), private,
 * duplicated per-service) into one shared service every other domain can call —
 * admin actions (Sprint 11) in particular need `actorType: 'admin'` entries that
 * AuthListener's auth-only helper never produced.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog) private readonly logs: Repository<AuditLog>,
  ) {}

  /** Never throws — an audit write failure must not break the caller's real action. */
  async log(input: AuditLogInput): Promise<void> {
    try {
      await this.logs.save(
        this.logs.create({
          userId: input.userId,
          actorType: input.actorType,
          action: input.action,
          resourceType: input.resourceType,
          resourceId: input.resourceId ?? null,
          ip: input.ctx?.ip ?? null,
          userAgent: input.ctx?.userAgent ?? null,
          metadata: input.metadata ?? {},
        }),
      );
    } catch (e) {
      this.logger.error(`audit write failed for ${input.action}`, e as Error);
    }
  }

  async list(filter: AuditListFilter, q: CursorQueryDto) {
    const after = decodeCursor(q.cursor);
    const qb = this.logs
      .createQueryBuilder('l')
      .orderBy('l.created_at', 'DESC')
      .addOrderBy('l.id', 'DESC')
      .take(q.limit + 1);

    if (filter.userId)
      qb.andWhere('l.user_id = :userId', { userId: filter.userId });
    if (filter.action)
      qb.andWhere('l.action = :action', { action: filter.action });
    if (filter.resourceType) {
      qb.andWhere('l.resource_type = :resourceType', {
        resourceType: filter.resourceType,
      });
    }
    if (after) {
      qb.andWhere('(l.created_at, l.id) < (:c, :i)', {
        c: after.createdAt,
        i: after.id,
      });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > q.limit;
    const data = hasMore ? rows.slice(0, q.limit) : rows;
    return {
      data,
      hasMore,
      nextCursor: hasMore ? encodeCursor(data.at(-1)!) : null,
    };
  }
}
