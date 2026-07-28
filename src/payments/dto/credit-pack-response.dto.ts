import { ApiProperty } from '@nestjs/swagger';
import { CreditPack } from '../entities/credit-pack.entity';

export class CreditPackResponse {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true }) description: string | null;
  @ApiProperty() credits: number;
  @ApiProperty() priceCents: number;
  @ApiProperty() bestValue: boolean;
  @ApiProperty() displayOrder: number;

  constructor(pack: CreditPack) {
    Object.assign(this, {
      id: pack.id,
      name: pack.name,
      description: pack.description,
      credits: pack.credits,
      priceCents: pack.priceCents,
      bestValue: pack.bestValue,
      displayOrder: pack.displayOrder,
    });
  }
}
