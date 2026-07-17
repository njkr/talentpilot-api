import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Mirrors ApiMeta in common/exceptions/app.exception.ts — every response,
// success or failure, carries one of these (see TransformInterceptor /
// AllExceptionsFilter).
export class ApiMetaDto {
  @ApiProperty({
    description: 'Echoes the x-request-id header (or a generated one).',
  })
  requestId: string;

  @ApiProperty({ format: 'date-time' })
  timestamp: string;

  @ApiPropertyOptional({ nullable: true, description: 'List endpoints only.' })
  nextCursor?: string | null;

  @ApiPropertyOptional()
  hasMore?: boolean;

  @ApiPropertyOptional({ description: 'Only present when cheap to compute.' })
  total?: number;
}
