import { ApiProperty } from '@nestjs/swagger';
import {
  AtsReport,
  ScoreBreakdownEntry,
} from '../../ats/entities/ats-report.entity';
import { AtsKeywordMatch } from '../../ats/entities/ats-keyword-match.entity';

export class KeywordMatchResponse {
  @ApiProperty() keyword: string;
  @ApiProperty({ nullable: true }) canonical: string | null;
  @ApiProperty() category: string;
  @ApiProperty() importance: 'required' | 'preferred' | 'nice_to_have';
  @ApiProperty() status: 'matched' | 'partial' | 'missing';
  @ApiProperty({ nullable: true }) evidence: string | null;
  @ApiProperty({ type: [String] }) foundIn: string[];
  @ApiProperty({ nullable: true }) suggestion: string | null;

  constructor(m: AtsKeywordMatch) {
    Object.assign(this, {
      keyword: m.keyword,
      canonical: m.canonical,
      category: m.category,
      importance: m.importance,
      status: m.status,
      evidence: m.evidence,
      foundIn: m.foundIn,
      suggestion: m.suggestion,
    });
  }
}

export class AtsReportResponse {
  @ApiProperty() id: string;
  @ApiProperty() workspaceId: string;
  @ApiProperty() runId: string;
  @ApiProperty() overallScore: number;
  @ApiProperty() keywordScore: number;
  @ApiProperty() semanticScore: number;
  @ApiProperty() experienceScore: number;
  @ApiProperty({ nullable: true }) educationScore: number | null;
  @ApiProperty() projectScore: number;
  @ApiProperty() formatScore: number;
  @ApiProperty() grammarScore: number;
  @ApiProperty({ type: [Object] }) scoreBreakdown: ScoreBreakdownEntry[];
  @ApiProperty() summary: string;
  @ApiProperty({ type: [String] }) strengths: string[];
  @ApiProperty({ type: [String] }) weaknesses: string[];
  @ApiProperty({ type: [String] }) recommendations: string[];
  @ApiProperty({ type: [KeywordMatchResponse] })
  keywords: KeywordMatchResponse[];
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;

  constructor(report: AtsReport, keywords: AtsKeywordMatch[]) {
    Object.assign(this, {
      id: report.id,
      workspaceId: report.workspaceId,
      runId: report.runId,
      overallScore: report.overallScore,
      keywordScore: report.keywordScore,
      semanticScore: report.semanticScore,
      experienceScore: report.experienceScore,
      educationScore: report.educationScore,
      projectScore: report.projectScore,
      formatScore: report.formatScore,
      grammarScore: report.grammarScore,
      scoreBreakdown: report.scoreBreakdown,
      summary: report.summary,
      strengths: report.strengths,
      weaknesses: report.weaknesses,
      recommendations: report.recommendations,
      keywords: keywords.map((k) => new KeywordMatchResponse(k)),
      createdAt: report.createdAt,
    });
  }
}
