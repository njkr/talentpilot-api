import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CursorQueryDto } from 'src/common/dto/cursor-query.dto';

const USER_STATUSES = ['active', 'suspended', 'deleted'] as const;

export class AdminUserQueryDto extends CursorQueryDto {
  @ApiPropertyOptional({
    description: 'Case-insensitive email substring match.',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: USER_STATUSES })
  @IsOptional()
  @IsIn(USER_STATUSES)
  status?: (typeof USER_STATUSES)[number];

  @ApiPropertyOptional({
    default: 30,
    description: 'Window size for spendLastNDaysUsd.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  days: number = 30;
}
