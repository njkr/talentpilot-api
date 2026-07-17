import { ApiProperty } from '@nestjs/swagger';
import { User } from '../entities/user.entity';

export class UserResponseDto {
  @ApiProperty({
    format: 'uuid',
    example: '5f6e2f0a-8e3a-4b7a-9d3e-1a2b3c4d5e6f',
  })
  id: string;

  @ApiProperty({ example: 'jane@example.com' })
  email: string;

  @ApiProperty({
    description: 'False until the OTP from registration is confirmed.',
  })
  isVerified: boolean;

  @ApiProperty({ enum: ['user', 'admin'], example: 'user' })
  role: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  constructor(u: User) {
    Object.assign(this, {
      id: u.id,
      email: u.email,
      isVerified: u.isVerified,
      role: u.role,
      createdAt: u.createdAt,
    });
  }
}
