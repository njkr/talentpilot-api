import { ApiProperty } from '@nestjs/swagger';

class WorkspaceSummary {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() status: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: Date;
  @ApiProperty({
    nullable: true,
    description: 'Latest ATS report score, if one exists.',
  })
  score: number | null;
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

class ScoreTrendPoint {
  @ApiProperty() date: string;
  @ApiProperty() score: number;
}

class ScoreInsight {
  @ApiProperty({ nullable: true }) latestScore: number | null;
  @ApiProperty({ nullable: true }) averageScore: number | null;
  @ApiProperty({ nullable: true }) bestScore: number | null;
  @ApiProperty({
    type: [ScoreTrendPoint],
    description:
      'Up to the last 10 completed scores, oldest first — feeds a sparkline.',
  })
  trend: ScoreTrendPoint[];
}

class CreditInsight {
  @ApiProperty() balance: number;
  @ApiProperty() spentLast30Days: number;
  @ApiProperty() grantedLast30Days: number;
  @ApiProperty() monthlyAllowance: number;
  @ApiProperty({ description: 'balance ÷ the current per-analysis cost' })
  runsRemaining: number;
}

class SkillGap {
  @ApiProperty() keyword: string;
  @ApiProperty() missCount: number;
}

class ActivityDay {
  @ApiProperty() date: string;
  @ApiProperty() runs: number;
}

class ActionItem {
  @ApiProperty({
    enum: [
      'failed_run',
      'pending_suggestions',
      'low_credits',
      'incomplete_profile',
    ],
  })
  kind:
    | 'failed_run'
    | 'pending_suggestions'
    | 'low_credits'
    | 'incomplete_profile';
  @ApiProperty() label: string;
  @ApiProperty() href: string;
  @ApiProperty({ enum: ['high', 'medium', 'low'] }) priority:
    | 'high'
    | 'medium'
    | 'low';
}

class Attention {
  @ApiProperty() failedRuns: number;
  @ApiProperty() workspacesWithPendingSuggestions: number;
}

export class DashboardOverviewResponse {
  @ApiProperty() creditBalance: number;
  @ApiProperty({ type: PlanSummary }) plan: PlanSummary;
  @ApiProperty({ type: ResumeCounts }) resumes: ResumeCounts;
  @ApiProperty({ type: WorkspaceCounts }) workspaces: WorkspaceCounts;
  @ApiProperty() unreadNotifications: number;

  @ApiProperty({ type: ScoreInsight }) scoreInsight: ScoreInsight;
  @ApiProperty({ type: CreditInsight }) creditInsight: CreditInsight;
  @ApiProperty({
    type: [SkillGap],
    description:
      "Keywords most often missing across all the user's ATS reports.",
  })
  topGaps: SkillGap[];
  @ApiProperty({
    type: [ActivityDay],
    description: 'One entry per day for the last 14 days, zeros filled in.',
  })
  activity: ActivityDay[];
  @ApiProperty({ type: [ActionItem] }) actionItems: ActionItem[];
  @ApiProperty({ type: Attention }) attention: Attention;

  constructor(data: DashboardOverviewResponse) {
    Object.assign(this, data);
  }
}
