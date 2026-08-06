import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, LessThan, Repository } from 'typeorm';
import { createHash } from 'crypto';
import { Resume } from '../resumes/entities/resume.entity';
import { ResumeSection } from '../resumes/entities/resume-section.entity';
import { ResumeVersion } from './entities/resume-version.entity';
import {
  AiSuggestion,
  OptimizableSectionType,
} from '../suggestions/entities/ai-suggestion.entity';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { GeneratedDocument } from '../documents/entities/generated-document.entity';
import { AtsReport } from '../ats/entities/ats-report.entity';
import { AtsKeywordMatch } from '../ats/entities/ats-keyword-match.entity';
import {
  findSection,
  readSuggestionTarget,
  writeSuggestionTarget,
} from '../suggestions/utils/section-address.util';
import { flattenSection } from './utils/flatten-section.util';
import { diffWords } from 'diff';
import { FabricationGuardService } from '../suggestions/services/fabrication-guard.service';

export interface ApplyResult {
  version: number;
  applied: number;
  skipped: string[];
}

@Injectable()
export class ResumeVersionsService {
  constructor(
    @InjectRepository(Resume) private readonly resumes: Repository<Resume>,
    @InjectRepository(ResumeSection)
    private readonly sections: Repository<ResumeSection>,
    @InjectRepository(ResumeVersion)
    private readonly versions: Repository<ResumeVersion>,
    @InjectRepository(AiSuggestion)
    private readonly suggestions: Repository<AiSuggestion>,
    @InjectRepository(Workspace)
    private readonly workspaces: Repository<Workspace>,
    @InjectRepository(GeneratedDocument)
    private readonly generatedDocuments: Repository<GeneratedDocument>,
    @InjectRepository(AtsReport)
    private readonly atsReports: Repository<AtsReport>,
    @InjectRepository(AtsKeywordMatch)
    private readonly atsKeywordMatches: Repository<AtsKeywordMatch>,
    private readonly dataSource: DataSource,
    private readonly guard: FabricationGuardService,
  ) {}

  async listVersions(
    resumeId: string,
    userId: string,
  ): Promise<ResumeVersion[]> {
    await this.assertOwned(resumeId, userId);
    return this.versions.find({
      where: { resumeId },
      order: { version: 'DESC' },
    });
  }

  async listSuggestions(
    workspaceId: string,
    userId: string,
    status:
      | 'pending'
      | 'accepted'
      | 'rejected'
      | 'stale'
      | 'needs_info' = 'pending',
  ): Promise<AiSuggestion[]> {
    await this.assertWorkspaceOwned(workspaceId, userId);
    return this.suggestions.find({
      where: { workspaceId, status },
      order: { createdAt: 'ASC' },
    });
  }

  async rejectSuggestions(
    workspaceId: string,
    userId: string,
    suggestionIds: string[],
  ): Promise<number> {
    await this.assertWorkspaceOwned(workspaceId, userId);
    // needs_info is rejectable too — "skip" for a suggestion the user doesn't want
    // to supply a real detail for.
    const result = await this.suggestions.update(
      {
        id: In(suggestionIds),
        workspaceId,
        status: In(['pending', 'needs_info']),
      },
      { status: 'rejected', decidedAt: new Date() },
    );
    return result.affected ?? 0;
  }

  /**
   * The user supplies their own real text for a `needs_info` suggestion — the AI's
   * invented example (missingFact/exampleValue) was never appliable as-is. Re-runs
   * FabricationGuardService on what the user wrote: they could still introduce
   * something ungrounded, and the guard applies uniformly regardless of who wrote the
   * text. If it passes, the suggestion becomes a normal `pending` suggestion that
   * flows through the existing apply path unchanged; if it still fails, it stays
   * `needs_info` with updated guidance instead of silently accepting bad text.
   */
  async provideDetail(
    workspaceId: string,
    userId: string,
    suggestionId: string,
    newText: string,
  ): Promise<AiSuggestion> {
    const ws = await this.workspaces.findOne({
      where: { id: workspaceId, userId },
    });
    if (!ws) throw new NotFoundException();

    const suggestion = await this.suggestions.findOne({
      where: { id: suggestionId, workspaceId, status: 'needs_info' },
    });
    if (!suggestion) {
      throw new NotFoundException('No needs_info suggestion with that id.');
    }

    const resume = await this.assertOwned(ws.resumeId, userId);
    const sections = await this.sections.find({
      where: { resumeId: resume.id, version: resume.currentVersion },
    });
    const knownOrgs = this.guard.collectKnownOrgs(sections);
    const knownCertifications = this.guard.collectKnownCertifications(sections);
    const jdKeywords = await this.jdKeywordsFor(workspaceId);
    const check = this.guard.check(
      newText,
      resume.rawText ?? '',
      knownOrgs,
      [],
      knownCertifications,
      jdKeywords,
    );

    suggestion.newText = newText;
    if (!check.safe) {
      const summary = this.guard.summariseForNeedsInfo(check);
      suggestion.missingFact = summary.missingFact;
      suggestion.exampleValue = summary.exampleValue;
      suggestion.needsDirectEdit = summary.needsDirectEdit;
      // status stays 'needs_info'
    } else {
      suggestion.status = 'pending';
      suggestion.missingFact = null;
      suggestion.exampleValue = null;
      suggestion.needsDirectEdit = false;
    }
    return this.suggestions.save(suggestion);
  }

  /** Same gap-keyword vocabulary SuggestionsService.generate() builds worker-side —
   * duplicated here rather than shared because this module deliberately has no
   * dependency on the worker-only suggestions module. */
  private async jdKeywordsFor(workspaceId: string): Promise<string[]> {
    const report = await this.atsReports.findOne({
      where: { workspaceId },
      order: { createdAt: 'DESC' },
    });
    if (!report) return [];
    const gaps = await this.atsKeywordMatches.find({
      where: { atsReportId: report.id, status: In(['missing', 'partial']) },
    });
    return gaps.map((g) => g.keyword);
  }

  /**
   * Convenience wrapper for the API surface: clients already know the workspace (that's
   * where suggestions are listed from) but not necessarily the underlying resumeId.
   */
  async applyForWorkspace(
    workspaceId: string,
    userId: string,
    suggestionIds: string[],
  ): Promise<ApplyResult> {
    const ws = await this.workspaces.findOne({
      where: { id: workspaceId, userId },
    });
    if (!ws) throw new NotFoundException();
    return this.applySuggestions(
      ws.resumeId,
      userId,
      suggestionIds,
      workspaceId,
    );
  }

  /**
   * Apply a batch of accepted suggestions as ONE new version.
   *
   * Why batched: a user reviewing 10 suggestions and accepting 7 wants "v2 — optimised
   * for Stripe", not v2..v8. Per-suggestion versioning makes the history unreadable and
   * the diff view useless.
   *
   * Why a NEW version rather than editing in place: v1 is what the ATS report was
   * scored against. Mutating it would make every stored report refer to text that no
   * longer exists, and the user could never get back to their original.
   */
  async applySuggestions(
    resumeId: string,
    userId: string,
    suggestionIds: string[],
    workspaceId: string,
  ): Promise<ApplyResult> {
    const resume = await this.assertOwned(resumeId, userId);

    const suggestions = await this.suggestions.find({
      where: { id: In(suggestionIds), workspaceId, status: 'pending' },
    });

    return this.dataSource.transaction(async (m) => {
      const current = await m.find(ResumeSection, {
        where: { resumeId, version: resume.currentVersion },
      });
      const nextVersion = resume.currentVersion + 1;

      // Deep clone — we must not mutate the previous version's jsonb by reference.
      const cloned = current.map((s) => ({
        ...s,
        id: undefined as unknown as string,
        version: nextVersion,
        content: structuredClone(s.content),
      }));

      const skipped: string[] = [];
      let applied = 0;

      for (const sug of suggestions) {
        const sectionType = sug.sectionType as OptimizableSectionType;
        const section = findSection(cloned as ResumeSection[], sectionType);
        if (!section) {
          skipped.push(sug.id);
          continue;
        }

        // ── STALENESS CHECK ──
        // The user may have hand-edited this bullet after the suggestion was
        // generated. Applying anyway would silently discard their edit. Refuse and
        // tell them.
        const currentText = readSuggestionTarget(
          sectionType,
          section.content,
          sug.itemIndex,
          sug.bulletIndex,
        );
        const currentHash = currentText
          ? createHash('sha256').update(currentText).digest('hex')
          : null;
        if (currentText === null || currentHash !== sug.oldTextHash) {
          await m.update(AiSuggestion, sug.id, { status: 'stale' });
          skipped.push(sug.id);
          continue;
        }

        const wrote = writeSuggestionTarget(
          sectionType,
          section.content,
          sug.itemIndex,
          sug.bulletIndex,
          sug.newText,
        );
        if (!wrote) {
          skipped.push(sug.id);
          continue;
        }

        section.aiGenerated = true;
        await m.update(AiSuggestion, sug.id, {
          status: 'accepted',
          appliedVersion: nextVersion,
          decidedAt: new Date(),
        });
        applied++;
      }

      if (applied === 0) {
        // Don't create an empty version — it clutters history and confuses the diff view.
        return { version: resume.currentVersion, applied: 0, skipped };
      }

      await m.save(ResumeSection, cloned);
      const workspace = await m.findOne(Workspace, {
        where: { id: workspaceId },
      });
      await m.save(
        ResumeVersion,
        m.create(ResumeVersion, {
          resumeId,
          version: nextVersion,
          label: `Optimised for ${workspace?.name ?? 'this application'}`,
          changeSummary: `Applied ${applied} improvement${applied === 1 ? '' : 's'}`,
          createdBy: 'ai',
          workspaceId,
          suggestionsApplied: applied,
        }),
      );
      await m.update(Resume, resumeId, { currentVersion: nextVersion });
      await this.markDocumentsStale(m, resumeId, nextVersion);

      return { version: nextVersion, applied, skipped };
    });
  }

  /** Restore copies FORWARD as a new version — history is never rewritten. */
  async restore(
    resumeId: string,
    userId: string,
    targetVersion: number,
  ): Promise<{ version: number }> {
    const resume = await this.assertOwned(resumeId, userId);

    return this.dataSource.transaction(async (m) => {
      const source = await m.find(ResumeSection, {
        where: { resumeId, version: targetVersion },
      });
      if (!source.length) {
        throw new NotFoundException(`Version ${targetVersion} not found`);
      }

      const next = resume.currentVersion + 1;
      await m.save(
        ResumeSection,
        source.map((s) => ({
          ...s,
          id: undefined as unknown as string,
          version: next,
          content: structuredClone(s.content),
        })),
      );
      await m.save(
        ResumeVersion,
        m.create(ResumeVersion, {
          resumeId,
          version: next,
          label: `Restored from v${targetVersion}`,
          changeSummary: `Reverted to version ${targetVersion}`,
          createdBy: 'restore',
        }),
      );
      await m.update(Resume, resumeId, { currentVersion: next });
      await this.markDocumentsStale(m, resumeId, next);
      return { version: next };
    });
  }

  /**
   * Any already-generated document built from an older resume version no longer
   * reflects what's on record. The resume itself may be shared across multiple
   * workspaces, so this looks up every workspace pointing at it rather than just the
   * one the caller happened to be acting on.
   */
  private async markDocumentsStale(
    m: EntityManager,
    resumeId: string,
    newVersion: number,
  ): Promise<void> {
    const workspaceIds = (
      await m.find(Workspace, { where: { resumeId }, select: { id: true } })
    ).map((w) => w.id);
    if (!workspaceIds.length) return;

    await m.update(
      GeneratedDocument,
      {
        workspaceId: In(workspaceIds),
        status: 'ready',
        resumeVersion: LessThan(newVersion),
      },
      { status: 'stale' },
    );
  }

  async diff(resumeId: string, userId: string, from: number, to: number) {
    await this.assertOwned(resumeId, userId);
    const [a, b] = await Promise.all([
      this.sections.find({ where: { resumeId, version: from } }),
      this.sections.find({ where: { resumeId, version: to } }),
    ]);
    if (!a.length) throw new NotFoundException(`Version ${from} not found`);
    if (!b.length) throw new NotFoundException(`Version ${to} not found`);

    const types = new Set([...a, ...b].map((s) => s.sectionType));
    return [...types]
      .map((type) => {
        const oldText = flattenSection(a.find((s) => s.sectionType === type));
        const newText = flattenSection(b.find((s) => s.sectionType === type));
        return {
          sectionType: type,
          changed: oldText !== newText,
          // Word-level diff, not character-level: character diffs on prose produce
          // unreadable noise ("Le|d| the| team").
          changes: diffWords(oldText, newText).filter(
            (p) => p.added || p.removed || p.value.length < 200,
          ),
        };
      })
      .filter((d) => d.changed);
  }

  private async assertOwned(resumeId: string, userId: string): Promise<Resume> {
    const resume = await this.resumes.findOne({
      where: { id: resumeId, userId },
    });
    if (!resume) throw new NotFoundException();
    return resume;
  }

  private async assertWorkspaceOwned(
    workspaceId: string,
    userId: string,
  ): Promise<void> {
    const ws = await this.workspaces.findOne({
      where: { id: workspaceId, userId },
    });
    if (!ws) throw new NotFoundException();
  }
}
