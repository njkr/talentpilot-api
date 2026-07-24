import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class ActivatePromptDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  version: number;
}
