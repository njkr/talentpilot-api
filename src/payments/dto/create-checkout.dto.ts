import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { PlanKey } from '../entities/plan.entity';

export class CreateCheckoutDto {
  @ApiProperty({ enum: ['pro', 'ultimate'] })
  @IsIn(['pro', 'ultimate'])
  planKey: PlanKey;
}
