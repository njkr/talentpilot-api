import { ApiProperty } from '@nestjs/swagger';

export class ReferralStatsDto {
  @ApiProperty() invited: number;
  @ApiProperty() qualified: number;
  @ApiProperty() creditsEarned: number;
}

export class ReferralMeResponse {
  @ApiProperty() code: string;
  @ApiProperty() shareUrl: string;
  @ApiProperty() rewardPerReferral: number;
  @ApiProperty() enabled: boolean;
  @ApiProperty({ type: ReferralStatsDto }) stats: ReferralStatsDto;
}
