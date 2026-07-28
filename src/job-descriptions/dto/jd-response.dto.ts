import { ApiProperty } from '@nestjs/swagger';
import { JobDescription } from '../entities/job-description.entity';

// The sentinel ingest() falls back to when no position was given and the AI parse also
// came up empty — a JD stuck at this value never got a real position, same as company
// being null. Exported so the update DTO / service can recognise "user hasn't fixed this
// yet" without hardcoding the string a second place.
export const UNTITLED_POSITION = 'Untitled position';

// Fields the rest of the pipeline actively depends on: company drives research_company
// and the cover letter's opening/salutation (Sprint 12 bug — a JD with no company caused
// a cascading partial run the user only discovered after paying for the full analysis).
// position drives the cover letter's role-specific opening and every interview/roadmap
// prompt. Neither is enforced at the DB/AI-schema level (a real JD can genuinely omit
// one), so this is a soft "ask the user to confirm" signal for the FE, not a hard block —
// deliberately consistent with the pipeline's own graceful degradation (research_company
// stays optional; a run without a company still completes as 'partial', not 'failed').
function computeMissingFields(jd: JobDescription): string[] {
  const missing: string[] = [];
  if (!jd.company) missing.push('company');
  if (!jd.position || jd.position === UNTITLED_POSITION)
    missing.push('position');
  return missing;
}

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
  @ApiProperty({
    type: [String],
    description:
      'Fields the analyse pipeline works better with that came back empty — currently ' +
      '"company" and/or "position". Empty once status is "analyzed" and both are set. ' +
      'Not a hard requirement: a run can still proceed without them (e.g. research_company ' +
      'is skipped and the cover letter omits the company), but the FE should prompt the ' +
      'user to fill these in via PATCH /job-descriptions/:id before triggering analyze, ' +
      'rather than the user discovering it only after a partial run.',
  })
  missingFields: string[];
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
      missingFields: computeMissingFields(jd),
      createdAt: jd.createdAt,
    });
  }
}
