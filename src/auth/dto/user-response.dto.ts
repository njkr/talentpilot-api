import { ApiProperty } from '@nestjs/swagger';
import { User } from '../entities/user.entity';

export class UserResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() email: string;
  @ApiProperty() isVerified: boolean;
  @ApiProperty() role: string;
  @ApiProperty() createdAt: Date;
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
