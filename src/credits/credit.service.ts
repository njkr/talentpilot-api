import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { CreditLedger, CreditReason } from './entities/credit-ledger.entity';
import { Problems } from '../common/problems';

@Injectable()
export class CreditService {
  constructor(
    @InjectRepository(CreditLedger)
    private readonly ledger: Repository<CreditLedger>,
    private readonly dataSource: DataSource,
  ) {}

  async balance(userId: string, manager?: EntityManager): Promise<number> {
    const repo = manager ? manager.getRepository(CreditLedger) : this.ledger;
    const row = await repo
      .createQueryBuilder('l')
      .select('COALESCE(SUM(l.amount), 0)', 'total')
      .where('l.userId = :userId', { userId })
      .getRawOne<{ total: string }>();
    return Number(row?.total ?? 0);
  }

  /** Always succeeds — used for signup bonuses and refunds, never blocked by balance. */
  grant(
    userId: string,
    amount: number,
    reason: CreditReason,
    referenceId?: string,
    manager?: EntityManager,
  ): Promise<CreditLedger> {
    const repo = manager ? manager.getRepository(CreditLedger) : this.ledger;
    return repo.save(
      repo.create({ userId, amount, reason, referenceId: referenceId ?? null }),
    );
  }

  refund(
    userId: string,
    amount: number,
    reason: CreditReason,
    referenceId?: string,
  ) {
    return this.grant(userId, amount, reason, referenceId);
  }

  /** Debits in its own transaction — for callers who aren't already inside one. */
  async debit(
    userId: string,
    amount: number,
    reason: CreditReason,
    referenceId?: string,
  ): Promise<void> {
    await this.dataSource.transaction((m) =>
      this.debitWithin(m, userId, amount, reason, referenceId),
    );
  }

  /**
   * Debits within a caller-supplied transaction — e.g. WorkspacesService.analyze()
   * commits the run row and the debit together, so a crash between them can't leave
   * a charge with no run or a run with no charge.
   *
   * A transaction-scoped advisory lock (auto-released on commit/rollback) serializes
   * concurrent debits for the SAME user across different DB connections. Without it,
   * two debits racing on an append-only ledger could both read a sufficient balance
   * before either commits, and both go through — an append-only ledger has no single
   * row to lock the way `UPDATE ... WHERE balance >= n` would.
   */
  async debitWithin(
    manager: EntityManager,
    userId: string,
    amount: number,
    reason: CreditReason,
    referenceId?: string,
  ): Promise<void> {
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [userId]);

    const balance = await this.balance(userId, manager);
    if (balance < amount) {
      throw Problems.insufficientCredits(amount, balance);
    }

    const repo = manager.getRepository(CreditLedger);
    await repo.save(
      repo.create({
        userId,
        amount: -amount,
        reason,
        referenceId: referenceId ?? null,
      }),
    );
  }
}
