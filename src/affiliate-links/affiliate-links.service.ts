import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AffiliateLink,
  AffiliateResourceType,
} from './entities/affiliate-link.entity';

export interface CreateAffiliateLinkInput {
  resourceType: AffiliateResourceType;
  keyword?: string | null;
  urlTemplate: string;
  label: string;
  active?: boolean;
  priority?: number;
}

export type UpdateAffiliateLinkInput = Partial<CreateAffiliateLinkInput>;

@Injectable()
export class AffiliateLinksService {
  constructor(
    @InjectRepository(AffiliateLink)
    private readonly links: Repository<AffiliateLink>,
  ) {}

  // ── Read-path matcher, used by LearningRoadmapService ──────────────────────
  async findAffiliateUrl(
    resourceType: AffiliateResourceType,
    title: string,
  ): Promise<string | null> {
    const candidates = await this.links.find({
      where: { resourceType, active: true },
    });
    if (candidates.length === 0) return null;

    const lowerTitle = title.toLowerCase();
    const keywordMatches = candidates.filter(
      (c) => c.keyword && lowerTitle.includes(c.keyword.toLowerCase()),
    );

    // Highest priority wins; ties broken by the longer (more specific) keyword.
    const best =
      keywordMatches.length > 0
        ? keywordMatches.sort(
            (a, b) =>
              b.priority - a.priority ||
              (b.keyword?.length ?? 0) - (a.keyword?.length ?? 0),
          )[0]
        : (candidates.find((c) => c.keyword === null) ?? null);

    if (!best) return null;
    return best.urlTemplate.replace('{query}', encodeURIComponent(title));
  }

  // ── Admin CRUD ───────────────────────────────────────────────────────────
  list(): Promise<AffiliateLink[]> {
    return this.links.find({
      order: { resourceType: 'ASC', priority: 'DESC' },
    });
  }

  create(input: CreateAffiliateLinkInput): Promise<AffiliateLink> {
    return this.links.save(
      this.links.create({
        resourceType: input.resourceType,
        keyword: input.keyword ?? null,
        urlTemplate: input.urlTemplate,
        label: input.label,
        active: input.active ?? true,
        priority: input.priority ?? 0,
      }),
    );
  }

  async update(
    id: string,
    input: UpdateAffiliateLinkInput,
  ): Promise<AffiliateLink> {
    const link = await this.links.findOne({ where: { id } });
    if (!link) throw new NotFoundException('Affiliate link not found.');
    Object.assign(link, input);
    return this.links.save(link);
  }

  async delete(id: string): Promise<void> {
    const result = await this.links.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException('Affiliate link not found.');
    }
  }
}
