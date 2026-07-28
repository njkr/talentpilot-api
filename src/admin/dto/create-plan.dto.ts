import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PlanLimitsDto {
  @ApiProperty({ description: '-1 = unlimited' })
  @IsInt()
  @Min(-1)
  maxResumes: number;

  @ApiProperty({ description: '-1 = unlimited' })
  @IsInt()
  @Min(-1)
  maxWorkspaces: number;

  @ApiProperty({
    description:
      '-1 = unlimited. Not yet enforced anywhere — reserved for future use.',
  })
  @IsInt()
  @Min(-1)
  regenPerDay: number;
}

export class CreatePlanDto {
  @ApiProperty({ example: 'pro' })
  @IsString()
  @MaxLength(50)
  key: string;

  @ApiProperty({ example: 'Pro' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'USD cents. 0 = no monthly price (e.g. the free plan).',
  })
  @IsInt()
  @Min(0)
  priceMonthlyCents: number;

  @ApiPropertyOptional({
    description: 'USD cents. 0 or omitted = no yearly option for this plan.',
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  priceYearlyCents?: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  monthlyCredits: number;

  @ApiProperty({ type: PlanLimitsDto })
  @ValidateNested()
  @Type(() => PlanLimitsDto)
  limits: PlanLimitsDto;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  displayOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
