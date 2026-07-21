import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';

export class RegenerateCoverLetterDto {
  @ApiPropertyOptional({
    enum: ['professional', 'friendly', 'confident', 'enthusiastic'],
  })
  @IsOptional()
  @IsEnum(['professional', 'friendly', 'confident', 'enthusiastic'])
  tone?: 'professional' | 'friendly' | 'confident' | 'enthusiastic';

  @ApiPropertyOptional({ enum: ['short', 'standard', 'long'] })
  @IsOptional()
  @IsEnum(['short', 'standard', 'long'])
  length?: 'short' | 'standard' | 'long';
}
