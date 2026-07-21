import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CompanySynthesis } from '../../ai/schemas/company-synthesis.schema';

/**
 * Global, NOT per-user. Company facts are public information about a third party, not
 * user data — caching them globally means the 50th person applying to Stripe this week
 * pays nothing and everyone gets the same (fresher, better-researched) answer. Keyed by
 * a normalised hash so "Stripe, Inc." / "STRIPE" / "Stripe Inc" all hit the same row.
 */
@Entity('company_research_cache')
@Index(['companyHash'], { unique: true })
export class CompanyResearchCache {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'company_hash' }) companyHash: string;
  @Column({ name: 'company_name' }) companyName: string;

  @Column({ type: 'jsonb' }) payload: CompanySynthesis;

  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
