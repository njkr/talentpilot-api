import { ApiProperty } from '@nestjs/swagger';
import { CreditLedger, CreditReason } from '../entities/credit-ledger.entity';

export class CreditLedgerResponse {
  @ApiProperty() id: string;
  @ApiProperty() amount: number;
  @ApiProperty() reason: CreditReason;
  @ApiProperty({ required: false, nullable: true }) referenceId: string | null;
  @ApiProperty({ required: false, nullable: true }) referenceType:
    | string
    | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;

  constructor(l: CreditLedger) {
    Object.assign(this, {
      id: l.id,
      amount: l.amount,
      reason: l.reason,
      referenceId: l.referenceId,
      referenceType: l.referenceType,
      createdAt: l.createdAt,
    });
  }
}

export class CreditBalanceResponse {
  @ApiProperty() balance: number;
  constructor(balance: number) {
    this.balance = balance;
  }
}
