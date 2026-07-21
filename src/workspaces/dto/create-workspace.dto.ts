import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateWorkspaceDto {
  @ApiProperty() @IsUUID() resumeId: string;
  @ApiProperty() @IsUUID() jobDescriptionId: string;

  @ApiProperty({ example: 'Acme Corp — Senior Backend Engineer' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;
}
