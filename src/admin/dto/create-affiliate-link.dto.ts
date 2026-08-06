import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AffiliateResourceType } from '../../affiliate-links/entities/affiliate-link.entity';

const RESOURCE_TYPES = [
  'documentation',
  'course',
  'book',
  'project',
  'other',
] as const;

export class CreateAffiliateLinkDto {
  @ApiProperty({ enum: RESOURCE_TYPES })
  @IsIn(RESOURCE_TYPES)
  resourceType: AffiliateResourceType;

  @ApiPropertyOptional({
    description:
      'Case-insensitive substring matched against the roadmap item title. Omit to make ' +
      'this the default template for the resourceType (at most one default per type).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;

  @ApiProperty({
    example: 'https://www.amazon.com/s?k={query}&tag=yourtag-20',
    description: 'Must contain the literal placeholder "{query}".',
  })
  @IsString()
  @Matches(/\{query\}/, {
    message: 'urlTemplate must contain the literal placeholder "{query}"',
  })
  urlTemplate: string;

  @ApiProperty({ example: 'Amazon — book search (default)' })
  @IsString()
  @MaxLength(150)
  label: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    default: 0,
    description:
      'Tie-break when multiple keyword rows match the same title — higher wins.',
  })
  @IsOptional()
  @IsInt()
  priority?: number;
}
