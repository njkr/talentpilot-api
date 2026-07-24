import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';

export class UpdatePreferencesDto {
  @ApiProperty({
    type: [String],
    description:
      'Notification `type` values the user does NOT want emailed. In-app notifications are always created regardless.',
  })
  @IsArray()
  @IsString({ each: true })
  emailDisabled: string[];
}
