import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from './user-response.dto';
export class SessionResponseDto {
  @ApiProperty() accessToken: string;
  @ApiProperty() user: UserResponseDto;
  // refreshToken is NOT here — it goes in an httpOnly cookie (see controller)
}
