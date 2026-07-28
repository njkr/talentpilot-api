import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { PlanKey } from '../entities/plan.entity';

export class SwitchPlanDto {
  // Not @IsIn(['pro','ultimate']) — same reasoning as CreateCheckoutDto (Sprint 13):
  // plans are admin-created, so PaymentsService.switchPlan() validates against the
  // actual active plans instead of a hardcoded list.
  @ApiProperty({ example: 'ultimate' })
  @IsString()
  planKey: PlanKey;

  @ApiPropertyOptional({ enum: ['month', 'year'], default: 'month' })
  @IsOptional()
  @IsIn(['month', 'year'])
  interval?: 'month' | 'year';
}
