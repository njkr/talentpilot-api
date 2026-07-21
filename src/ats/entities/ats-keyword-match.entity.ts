import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AtsReport } from './ats-report.entity';

/**
 * Named AtsKeywordMatch (not KeywordMatch) deliberately — `KeywordMatch` is already the
 * name of the in-memory result interface in ats/services/keyword-matcher.service.ts
 * (Sprint 4). This entity is that data persisted; keeping the names distinct avoids an
 * import collision anywhere both are used (e.g. AtsService).
 */
@Entity('keyword_matches')
@Index(['atsReportId'])
export class AtsKeywordMatch {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'ats_report_id', type: 'uuid' }) atsReportId: string;
  @ManyToOne(() => AtsReport, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ats_report_id' })
  report: AtsReport;

  @Column() keyword: string;
  @Column({ nullable: true }) canonical: string | null;
  @Column({ type: 'varchar' }) category: string;
  @Column({ type: 'varchar' }) importance:
    | 'required'
    | 'preferred'
    | 'nice_to_have';
  @Column({ type: 'varchar' }) status: 'matched' | 'partial' | 'missing';
  @Column({ type: 'text', nullable: true }) evidence: string | null;
  @Column({ name: 'found_in', type: 'jsonb', default: () => "'[]'" })
  foundIn: string[];
  @Column({ type: 'text', nullable: true }) suggestion: string | null;
}
