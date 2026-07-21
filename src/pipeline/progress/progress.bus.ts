import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { Env } from '../../config/config.module';

export type RunEvent =
  | { type: 'run.started'; runId: string; stepsTotal: number }
  | {
      type: 'step.started';
      runId: string;
      step: string;
      label: string;
      progress: number;
    }
  | {
      type: 'step.completed';
      runId: string;
      step: string;
      progress: number;
      payload?: unknown;
    }
  | {
      type: 'step.failed';
      runId: string;
      step: string;
      willRetry: boolean;
      attempt: number;
    }
  | {
      type: 'step.skipped';
      runId: string;
      step: string;
      progress: number;
      reason: string;
    }
  | { type: 'run.completed'; runId: string; progress: 100; durationMs: number }
  | {
      type: 'run.failed';
      runId: string;
      status: 'failed' | 'partial';
      failedSteps: string[];
      refundedCredits: number;
    };

@Injectable()
export class ProgressBus implements OnModuleInit, OnModuleDestroy {
  private pub!: Redis;
  private sub!: Redis;
  private handlers = new Map<string, Set<(e: RunEvent) => void>>();

  constructor(private readonly env: Env) {}

  onModuleInit() {
    this.pub = new Redis(this.env.get('REDIS_URL'));

    /**
     * TWO connections, not one. A Redis client in subscriber mode can only run
     * subscribe/unsubscribe — any other command errors. Sharing one client means
     * publishes start failing the moment you subscribe.
     */
    this.sub = new Redis(this.env.get('REDIS_URL'));

    this.sub.on(
      'pmessage',
      (_pattern: string, channel: string, raw: string) => {
        const runId = channel.split(':')[1];
        const event = JSON.parse(raw) as RunEvent;
        this.handlers.get(runId)?.forEach((h) => h(event));
      },
    );
    // Pattern subscribe once, filter in memory. Subscribing/unsubscribing per client
    // would thrash Redis when many users watch runs simultaneously.
    this.sub.psubscribe('run:*');
  }

  onModuleDestroy() {
    this.pub?.disconnect();
    this.sub?.disconnect();
  }

  /** Called from the WORKER process. */
  publish(runId: string, event: RunEvent) {
    return this.pub.publish(`run:${runId}`, JSON.stringify(event));
  }

  /**
   * Called from the API process, per SSE connection.
   *
   * Pub/sub is why this works across multiple API replicas: the worker publishes once,
   * EVERY api replica receives it, and the one holding the user's connection forwards
   * it. An in-process EventEmitter would only reach users whose SSE landed on the same
   * instance as the worker — which is never, since they're different processes.
   */
  subscribe(runId: string, handler: (e: RunEvent) => void): () => void {
    if (!this.handlers.has(runId)) this.handlers.set(runId, new Set());
    this.handlers.get(runId)!.add(handler);
    return () => {
      const set = this.handlers.get(runId);
      set?.delete(handler);
      if (set?.size === 0) this.handlers.delete(runId);
    };
  }
}
