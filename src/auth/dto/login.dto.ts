import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
export class LoginDto {
  @IsEmail() email: string;
  @IsString() @IsNotEmpty() password: string; // NO length rules here — a policy change
}
