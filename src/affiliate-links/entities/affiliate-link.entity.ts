import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type AffiliateResourceType =
  | 'documentation'
  | 'course'
  | 'book'
  | 'project'
  | 'other';

// Learning roadmap resource titles are AI-generated (see LearningRoadmapService.generate())
// and often invented rather than drawn from a fixed catalog — there is no stable "product
// id" to attach an exact affiliate link to. Rows here are matched at READ time, not stored
// against a roadmap item: a `keyword` row (case-insensitive substring against the item's
// title) wins if one matches, otherwise the `keyword IS NULL` row for that resourceType (the
// generic template, e.g. an Amazon/Udemy affiliate SEARCH link) is used as the fallback.
// `urlTemplate` must contain the literal substring "{query}", replaced with the
// URL-encoded resource title at read time.
@Entity('affiliate_links')
// At most one default (keyword IS NULL) template per resourceType — a partial unique
// index, same technique as PromptTemplate's `one_active_version_per_key`, since a plain
// UNIQUE(resource_type, keyword) would treat every NULL as distinct and not enforce this.
@Index('one_default_per_resource_type', ['resourceType'], {
  unique: true,
  where: 'keyword IS NULL',
})
export class AffiliateLink {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'resource_type', type: 'varchar' })
  resourceType: AffiliateResourceType;

  @Column({ type: 'varchar', nullable: true })
  keyword: string | null;

  @Column({ name: 'url_template', type: 'text' })
  urlTemplate: string;

  @Column() label: string;

  @Column({ default: true }) active: boolean;

  @Column({ type: 'int', default: 0 }) priority: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
