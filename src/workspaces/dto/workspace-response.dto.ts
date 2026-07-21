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

  constructor(w: Workspace) {
    Object.assign(this, {
      id: w.id,
      name: w.name,
      resumeId: w.resumeId,
      jobDescriptionId: w.jobDescriptionId,
      status: w.status,
      lastRunId: w.lastRunId,
      analyzedResumeVersion: w.analyzedResumeVersion,
      createdAt: w.createdAt,
    });
  }
}
