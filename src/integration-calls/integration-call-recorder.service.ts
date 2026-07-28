import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  IntegrationCall,
  IntegrationProvider,
} from './entities/integration-call.entity';

export interface RecordIntegrationCallInput {
  provider: IntegrationProvider;
  operation: string;
  success: boolean;
  errorType?: string | null;
  durationMs: number;
  metadata?: Record<string, unknown> | null;
}

/**
 * A metering write must never break the real operation it's observing — same principle as
 * AiService's safeRecordUsage for token_usage. Every call site here wraps a REAL third-party
 * request (send an email, upload a file, call Stripe); if logging that fact to Postgres fails,
 * the caller still needs its email sent / file uploaded / Stripe call completed. Swallow and log,
 * never throw.
 */
@Injectable()
export class IntegrationCallRecorderService {
  private readonly logger = new Logger(IntegrationCallRecorderService.name);

  constructor(
    @InjectRepository(IntegrationCall)
    private readonly calls: Repository<IntegrationCall>,
  ) {}

  async record(entry: RecordIntegrationCallInput): Promise<void> {
    try {
      await this.calls.save(
        this.calls.create({
          provider: entry.provider,
          operation: entry.operation,
          success: entry.success,
          errorType: entry.errorType ?? null,
          durationMs: entry.durationMs,
          metadata: entry.metadata ?? null,
        }),
      );
    } catch (err) {
      this.logger.error(
        `failed to record ${entry.provider} integration call`,
        err as Error,
      );
    }
  }
}
