import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { createHash } from 'crypto';
import { AiService } from '../ai/ai.service';
import { ResumeOptimization } from '../ai/schemas/resume-optimization.schema';
import {
  AiSuggestion,
  OptimizableSectionType,
} from './entities/ai-suggestion.entity';
import { AtsKeywordMatch } from '../ats/entities/ats-keyword-match.entity';
import { AtsReport } from '../ats/entities/ats-report.entity';
import { ResumeSection } from '../resumes/entities/resume-section.entity';
import { PipelineContext } from '../pipeline/steps/step.interface';
import { FabricationGuardService } from './services/fabrication-guard.service';
import { renderJdSummary } from '../job-descriptions/utils/render-jd.util';
import {
  findSection,
  readSuggestionTarget,
  renderSectionsWithIndices,
} from './utils/section-address.util';

// required first, then preferred, then nice_to_have — NOT alphabetical (which would
// put "nice_to_have" ahead of "required"). The optimiser should see the gaps that
// matter most, first.
const IMPORTANCE_RANK: Record<string, number> = {
  required: 0,
  preferred: 1,
  nice_to_have: 2,
};

interface ExperienceItemLike {
  company: string | null;
}
interface EducationItemLike {
  institution: string | null;
}
interface CertificationItemLike {
  issuer: string | null;
}
interface ProjectItemLike {
  name: string | null;
}

@Injectable()
export class SuggestionsService {
  private readonly logger = new Logger(SuggestionsService.name);

  constructor(
    private readonly ai: AiService,
    private readonly guard: FabricationGuardService,
    @InjectRepository(AiSuggestion)
    private readonly suggestions: Repository<AiSuggestion>,
    @InjectRepository(AtsKeywordMatch)
    private readonly matches: Repository<AtsKeywordMatch>,
  ) {}

  async generate(
    ctx: PipelineContext,
    report: AtsReport,
  ): Promise<AiSuggestion[]> {
    const gaps = (
      await this.matches.find({
        where: { atsReportId: report.id, status: In(['missing', 'partial']) },
      })
    ).sort(
      (a, b) =>
        (IMPORTANCE_RANK[a.importance] ?? 99) -
        (IMPORTANCE_RANK[b.importance] ?? 99),
    );

    const { data: out } = await this.ai.complete<ResumeOptimization>({
      feature: 'resume_optimization',
      promptKey: 'resume_optimization',
      variables: {
        jd_summary: renderJdSummary(ctx.jd),
        gap_list:
          gaps
            .map((g) => `- ${g.keyword} (${g.importance}, ${g.status})`)
            .join('\n') || 'No gaps identified.',
        ats_weaknesses: report.weaknesses.join('\n') || 'None noted.',
        resume_sections: renderSectionsWithIndices(ctx.sections),
      },
      truncateVariable: 'resume_sections',
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      runId: ctx.runId,
      stepName: 'optimize_resume',
    });

    const knownOrgs = this.collectOrgs(ctx.sections);
    const sourceText = ctx.resume.rawText ?? '';
    const accepted: Array<Partial<AiSuggestion>> = [];
    let dropped = 0;

    for (const s of out.suggestions) {
      // ── Guard 1: fabrication ──
      const check = this.guard.check(s.newText, sourceText, knownOrgs);
      if (!check.safe) {
        dropped++;
        continue;
      }

      // ── Guard 2: oldText must actually exist ──
      // The model is told to reproduce it exactly; sometimes it paraphrases. If we
      // can't locate the text, we cannot apply the change safely, so the suggestion
      // is useless.
      const sectionType = s.sectionType as OptimizableSectionType;
      const section = findSection(ctx.sections, sectionType);
      const actual = section
        ? readSuggestionTarget(
            sectionType,
            section.content,
            s.itemIndex,
            s.bulletIndex,
          )
        : null;
      if (actual === null || this.loose(actual) !== this.loose(s.oldText)) {
        dropped++;
        continue;
      }

      // ── Guard 3: no-op suggestions ──
      if (this.loose(actual) === this.loose(s.newText)) {
        dropped++;
        continue;
      }

      accepted.push({
        workspaceId: ctx.workspaceId,
        runId: ctx.runId,
        sectionType,
        itemIndex: s.itemIndex,
        bulletIndex: s.bulletIndex,
        oldText: actual, // store the REAL text, not the model's possibly-paraphrased copy
        oldTextHash: createHash('sha256').update(actual).digest('hex'),
        newText: s.newText,
        reason: s.reason,
        impact: s.impact,
        keywordsAdded: s.keywordsAdded,
        status: 'pending',
      });
    }

    if (dropped) {
      this.logger.warn(
        `Dropped ${dropped}/${out.suggestions.length} suggestions for workspace ${ctx.workspaceId}`,
      );
    }
    if (!accepted.length) return [];
    return this.suggestions.save(this.suggestions.create(accepted));
  }

  private collectOrgs(sections: ResumeSection[]): string[] {
    const orgs: string[] = [];
    for (const s of sections) {
      if (s.sectionType === 'experience') {
        orgs.push(
          ...(s.content as ExperienceItemLike[]).map((e) => e.company ?? ''),
        );
      }
      if (s.sectionType === 'education') {
        orgs.push(
          ...(s.content as EducationItemLike[]).map((e) => e.institution ?? ''),
        );
      }
      if (s.sectionType === 'certifications') {
        orgs.push(
          ...(s.content as CertificationItemLike[]).map((c) => c.issuer ?? ''),
        );
      }
      if (s.sectionType === 'projects') {
        orgs.push(...(s.content as ProjectItemLike[]).map((p) => p.name ?? ''));
      }
    }
    return orgs.filter(Boolean);
  }

  private loose(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]/g, '');
  }
}
