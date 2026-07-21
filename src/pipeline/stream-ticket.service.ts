import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { randomBytes } from 'crypto';
import { Env } from '../config/config.module';
import { Problems } from '../common/problems';

const TICKET_TTL_SEC = 60;

/**
 * ⚠️ THE EVENTSOURCE PROBLEM
 *
 * The browser's EventSource API cannot set request headers — no Authorization, nothing.
 * So the stream endpoint cannot use the Bearer token every other endpoint uses.
 *
 * Rejected alternatives:
 *  - Put the access token in the query string: it lands in server logs, proxy logs,
 *    and browser history. A 15-minute credential leaking into logs is a real incident.
 *  - Widen the auth cookie to all paths: gives up the CSRF protection of path scoping.
 *  - Use fetch + ReadableStream instead of EventSource: works, but reimplements
 *    reconnection, Last-Event-ID, and parsing from scratch.
 *
 * Chosen: a single-use ticket. The client POSTs (authenticated normally) to mint a
 * 60-second ticket bound to (user, run), then opens the stream with it. Leaking a
 * ticket costs read access to one run's progress for under a minute.
 */
@Injectable()
export class StreamTicketService implements OnModuleInit, OnModuleDestroy {
  private redis!: Redis;

  constructor(private readonly env: Env) {}

  onModuleInit() {
    this.redis = new Redis(this.env.get('REDIS_URL'));
  }

  onModuleDestroy() {
    this.redis?.disconnect();
  }

  async mint(userId: string, runId: string): Promise<string> {
    const ticket = randomBytes(24).toString('base64url');
    await this.redis.setex(
      `stream:${ticket}`,
      TICKET_TTL_SEC,
      JSON.stringify({ userId, runId }),
    );
    return ticket;
  }

  async consume(
    ticket: string | undefined,
  ): Promise<{ userId: string; runId: string }> {
    if (!ticket) throw Problems.streamTicketInvalid();
    const key = `stream:${ticket}`;
    const raw = await this.redis.get(key);
    if (!raw) throw Problems.streamTicketInvalid();
    await this.redis.del(key); // single use
    return JSON.parse(raw);
  }
}
