import { ApiProperty } from '@nestjs/swagger';
import { Workspace } from '../entities/workspace.entity';

export class WorkspaceResponse {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() resumeId: string;
  @ApiProperty() jobDescriptionId: string;
  @ApiProperty() status: string;
  @ApiProperty({ nullable: true }) lastRunId: string | null;
  @ApiProperty({ nullable: true }) analyzedResumeVersion: number | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
  @ApiProperty({
    nullable: true,
    description:
      'The most recent AtsReport.overallScore for this workspace (across every ' +
      'report/rescore, not just the original). null until the first analysis produces ' +
      'a score.',
  })
  overallScore: number | null;

  constructor(w: Workspace, overallScore: number | null = null) {
    Object.assign(this, {
      id: w.id,
      name: w.name,
      resumeId: w.resumeId,
      jobDescriptionId: w.jobDescriptionId,
      status: w.status,
      lastRunId: w.lastRunId,
      analyzedResumeVersion: w.analyzedResumeVersion,
      createdAt: w.createdAt,
      overallScore,
    });
  }
}
