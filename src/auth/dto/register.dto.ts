import {
  IsEmail,
  IsString,
  MinLength,
  MaxLength,
  Matches,
  IsOptional,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({
    example: 'jane@example.com',
    maxLength: 255,
    description:
      'Lowercased and trimmed server-side before the uniqueness check.',
  })
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiProperty({
    example: 'Sup3rSecret!',
    minLength: 8,
    maxLength: 72,
    description:
      'At least one letter and one digit. 72 chars is the practical input ceiling for argon2/bcrypt.',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(72) // 72 = argon2/bcrypt practical input ceiling
  @Matches(/[A-Za-z]/, { message: 'password must contain a letter' })
  @Matches(/\d/, { message: 'password must contain a number' })
  password: string;

  @ApiPropertyOptional({
    example: 'ABCD234',
    description:
      "Another user's referral code (see GET /referrals/me). Invalid or unknown " +
      'codes are ignored silently — a bad code must never block registration.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  referralCode?: string;
}
