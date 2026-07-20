import {
  IsInt,
  IsISO4217CurrencyCode,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Jane' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Doe' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional({ example: '+1 415 555 0100' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  // Validate the HOST, not just "is a URL" — otherwise users paste anything and the
  // frontend renders a "LinkedIn" link pointing at a random site.
  @ApiPropertyOptional({ example: 'https://linkedin.com/in/janedoe' })
  @IsOptional()
  @IsUrl({ host_whitelist: [/linkedin\.com$/] })
  linkedin?: string;

  @ApiPropertyOptional({ example: 'https://github.com/janedoe' })
  @IsOptional()
  @IsUrl({ host_whitelist: [/github\.com$/] })
  github?: string;

  @ApiPropertyOptional({ example: 'https://janedoe.dev' })
  @IsOptional()
  @IsUrl()
  portfolio?: string;

  @ApiPropertyOptional({ example: 'United States' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  @ApiPropertyOptional({ example: 'San Francisco' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ example: 'America/Los_Angeles' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @ApiPropertyOptional({ example: 5, minimum: 0, maximum: 60 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  yearsExperience?: number;

  @ApiPropertyOptional({ example: 'Senior Backend Engineer' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  targetRole?: string;

  @ApiPropertyOptional({ example: 150000, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  salaryExpectation?: number;

  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional()
  @IsISO4217CurrencyCode()
  salaryCurrency?: string;
}
