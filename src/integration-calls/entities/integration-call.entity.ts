import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// The 4 third-party integrations that had ZERO historical tracking before this (OpenAI is
// deliberately excluded — it already has its own richer, actively-used token_usage table
// backing BudgetService's daily spend limits; this table must never duplicate or replace that).
export type IntegrationProvider = 'resend' | 'tavily' | 'stripe' | 's3';

/**
 * One row per outbound call to a third-party integration — the same "know what actually
 * happened" instinct behind token_usage, generalized to the providers that had nothing. Plain
 * varchar `provider`/`operation` (not a pg enum), matching this codebase's existing convention
 * for extensible string fields (CreditReason, WorkspaceStatus, ...).
 */
@Entity('integration_calls')
@Index(['provider', 'createdAt']) // per-provider daily history query
export class IntegrationCall {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ type: 'varchar' }) provider: IntegrationProvider;
  // 'email.send' | 'search' | '<method> <path>' (stripe) | 'PutObject'/'GetObject'/... (s3)
  @Column({ type: 'varchar' }) operation: string;

  @Column({ default: true }) success: boolean;
  @Column({ name: 'error_type', type: 'varchar', nullable: true })
  errorType: string | null;

  @Column({ name: 'duration_ms', type: 'int' }) durationMs: number;

  // Small optional context only (e.g. { template: 'verify-email' }, { bucket }) — never the
  // full request/response payload.
  @Column({ type: 'jsonb', nullable: true }) metadata: Record<
    string,
    unknown
  > | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
