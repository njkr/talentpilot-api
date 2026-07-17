import { IsEmail, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyOtpDto {
  @ApiProperty({ example: 'jane@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({
    example: '482913',
    description: '6-digit code emailed on registration or resend.',
  })
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code: string;
}
