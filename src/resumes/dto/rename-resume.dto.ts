import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RenameResumeDto {
  @ApiProperty({ example: 'Senior Backend Engineer — 2026' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;
}
