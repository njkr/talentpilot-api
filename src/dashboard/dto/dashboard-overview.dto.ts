import { ApiProperty } from '@nestjs/swagger';

class WorkspaceSummary {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() status: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: Date;
}

class WorkspaceCounts {
  @ApiProperty() total: number;
  @ApiProperty() completed: number;
  @ApiProperty() processing: number;
  @ApiProperty() failed: number;
  @ApiProperty({ type: [WorkspaceSummary] }) recent: WorkspaceSummary[];
}

class PlanSummary {
  @ApiProperty() key: string;
  @ApiProperty() name: string;
  @ApiProperty() status: string;
  @ApiProperty() monthlyCredits: number;
}

class ResumeCounts {
  @ApiProperty() count: number;
  @ApiProperty({ description: '-1 = unlimited' }) limit: number;
}

export class DashboardOverviewResponse {
  @ApiProperty() creditBalance: number;
  @ApiProperty({ type: PlanSummary }) plan: PlanSummary;
  @ApiProperty({ type: ResumeCounts }) resumes: ResumeCounts;
  @ApiProperty({ type: WorkspaceCounts }) workspaces: WorkspaceCounts;
  @ApiProperty() unreadNotifications: number;

  constructor(data: DashboardOverviewResponse) {
    Object.assign(this, data);
  }
}
