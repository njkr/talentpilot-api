import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from './user-response.dto';

export class SessionResponseDto {
  @ApiProperty({
    description:
      'Short-lived JWT (see JWT_ACCESS_TTL). Send as `Authorization: Bearer <token>`.',
  })
  accessToken: string;

  @ApiProperty({ type: UserResponseDto })
  user: UserResponseDto;
  // refreshToken is NOT here — it goes in an httpOnly `tp_rt` cookie (see AuthController)
}
