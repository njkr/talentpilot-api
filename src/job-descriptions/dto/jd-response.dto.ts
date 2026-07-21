import { ApiProperty } from '@nestjs/swagger';
import { JobDescription } from '../entities/job-description.entity';

// Deliberately never includes descriptionRaw (large) or userId (ownership is implicit —
// every route this DTO comes back from already scoped the query to the caller).
export class JdResponse {
  @ApiProperty() id: string;
  @ApiProperty({ nullable: true }) company: string | null;
  @ApiProperty() position: string;
  @ApiProperty() source: string;
  @ApiProperty({ nullable: true }) employmentType: string | null;
  @ApiProperty({ nullable: true }) location: string | null;
  @ApiProperty({ nullable: true }) remoteType: string | null;
  @ApiProperty({ nullable: true }) experienceRequired: string | null;
  @ApiProperty({ nullable: true }) salaryMin: number | null;
  @ApiProperty({ nullable: true }) salaryMax: number | null;
  @ApiProperty({ nullable: true }) salaryCurrency: string | null;
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  parsedData: unknown;
  @ApiProperty() status: string;
  @ApiProperty({ nullable: true }) parseError: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;

  constructor(jd: JobDescription) {
    Object.assign(this, {
      id: jd.id,
      company: jd.company,
      position: jd.position,
      source: jd.source,
      employmentType: jd.employmentType,
      location: jd.location,
      remoteType: jd.remoteType,
      experienceRequired: jd.experienceRequired,
      salaryMin: jd.salaryMin,
      salaryMax: jd.salaryMax,
      salaryCurrency: jd.salaryCurrency,
      parsedData: jd.parsedData,
      status: jd.status,
      parseError: jd.parseError,
      createdAt: jd.createdAt,
    });
  }
}
