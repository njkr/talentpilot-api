import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ErrorCode } from '../exceptions/app.exception';
import { ApiMetaDto } from './api-meta.dto';

// Mirrors ApiErrorBody / ApiFailure in common/exceptions/app.exception.ts —
// this is the exact shape AllExceptionsFilter writes for every non-2xx response.
export class ApiErrorBodyDto {
  @ApiProperty({
    enum: Object.values(ErrorCode),
    example: ErrorCode.VALIDATION_FAILED,
  })
  code: ErrorCode;

  @ApiProperty({ description: 'Human-readable, safe to display as-is.' })
  message: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description:
      'Machine-usable context, e.g. { retryAfterSec } or { remaining }.',
  })
  details?: Record<string, unknown>;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'array', items: { type: 'string' } },
    description:
      'Validation errors keyed by field name (VALIDATION_FAILED only).',
  })
  fields?: Record<string, string[]>;
}

export class ApiErrorEnvelopeDto {
  @ApiProperty({ example: false })
  success: false;

  @ApiProperty({ type: ApiErrorBodyDto })
  error: ApiErrorBodyDto;

  @ApiProperty({ type: ApiMetaDto })
  meta: ApiMetaDto;
}
