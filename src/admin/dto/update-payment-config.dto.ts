import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { ReferralQualifyingEvent } from '../../payments/entities/payment-config.entity';

const QUALIFYING_EVENTS: ReferralQualifyingEvent[] = [
  'signup',
  'email_verified',
  'first_analysis',
  'first_payment',
];

export class UpdatePaymentConfigDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  signupCreditGrant?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  referrerReward?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  refereeReward?: number;

  @ApiPropertyOptional({ enum: QUALIFYING_EVENTS })
  @IsOptional()
  @IsIn(QUALIFYING_EVENTS)
  referralQualifyingEvent?: ReferralQualifyingEvent;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  maxReferralRewardsPerUser?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  analyzeCost?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  coverLetterRegenCost?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  interviewFeedbackCost?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  referralsEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  creditPacksEnabled?: boolean;
}
