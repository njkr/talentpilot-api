import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

// Fixes what upload()/paste() couldn't get from the AI parse or the user didn't supply
// up front — see JdResponse.missingFields. upload() in particular has no way to pass
// company/position at ingest time (it's a raw file), so this is the only way to fill
// them in afterward without deleting and re-uploading.
export class UpdateJdDto {
  @ApiPropertyOptional({ example: 'Senior Backend Engineer' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  position?: string;

  @ApiPropertyOptional({ example: 'Acme Corp' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  company?: string;
}
