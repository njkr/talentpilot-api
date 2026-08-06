import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ProvideSuggestionDetailDto {
  @ApiProperty({
    description:
      'Your own real text replacing the illustrative example — e.g. the same bullet ' +
      'with your actual metric/employer/credential filled in.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  newText: string;
}
