import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { PlanKey } from '../entities/plan.entity';

export class CreateCheckoutDto {
  // Sprint 13: plans are now admin-created, so the valid set of keys isn't knowable
  // at compile time — @IsIn(['pro','ultimate']) would reject any custom plan an admin
  // adds. PaymentsService.createCheckoutSession() already 404s on an unknown or
  // inactive key, which is the real validation.
  @ApiProperty({ example: 'pro' })
  @IsString()
  planKey: PlanKey;

  @ApiPropertyOptional({ enum: ['month', 'year'], default: 'month' })
  @IsOptional()
  @IsIn(['month', 'year'])
  interval?: 'month' | 'year';
}
