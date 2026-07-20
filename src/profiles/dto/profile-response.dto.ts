import { ApiProperty } from '@nestjs/swagger';
import { Profile } from '../entities/profile.entity';

export class ProfileResponse {
  @ApiProperty({ nullable: true }) firstName: string | null;
  @ApiProperty({ nullable: true }) lastName: string | null;
  @ApiProperty({ nullable: true }) phone: string | null;
  @ApiProperty({ nullable: true }) linkedin: string | null;
  @ApiProperty({ nullable: true }) github: string | null;
  @ApiProperty({ nullable: true }) portfolio: string | null;
  @ApiProperty({ nullable: true }) country: string | null;
  @ApiProperty({ nullable: true }) city: string | null;
  @ApiProperty({ nullable: true }) timezone: string | null;
  @ApiProperty({ nullable: true }) yearsExperience: number | null;
  @ApiProperty({ nullable: true }) targetRole: string | null;
  @ApiProperty({ nullable: true }) salaryExpectation: number | null;
  @ApiProperty({ nullable: true }) salaryCurrency: string | null;

  @ApiProperty({
    minimum: 0,
    maximum: 100,
    description:
      'Percentage of the "nudge" fields filled in — drives the "finish your profile" prompt.',
  })
  completeness: number;

  constructor(p: Profile, completeness: number) {
    Object.assign(this, {
      firstName: p.firstName,
      lastName: p.lastName,
      phone: p.phone,
      linkedin: p.linkedin,
      github: p.github,
      portfolio: p.portfolio,
      country: p.country,
      city: p.city,
      timezone: p.timezone,
      yearsExperience: p.yearsExperience,
      targetRole: p.targetRole,
      salaryExpectation: p.salaryExpectation,
      salaryCurrency: p.salaryCurrency,
      completeness,
    });
  }
}
