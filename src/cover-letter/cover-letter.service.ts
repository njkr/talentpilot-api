import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiService } from '../ai/ai.service';
import { CoverLetterOutput } from '../ai/schemas/cover-letter.schema';
import { CoverLetter } from './entities/cover-letter.entity';
import { CompanyInsight } from '../company/entities/company-insight.entity';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { Resume } from '../resumes/entities/resume.entity';
import { ResumeSection } from '../resumes/entities/resume-section.entity';
import { JobDescription } from '../job-descriptions/entities/job-description.entity';
import { ChunkerService } from '../embeddings/services/chunker.service';
import { CreditService } from '../credits/credit.service';
import { Problems } from '../common/problems';
import { renderJdSummary } from '../job-descriptions/utils/render-jd.util';

const WORDS: Record<'short' | 'standard' | 'long', number> = {
  short: 180,
  standard: 300,
  long: 450,
};

const REGENERATE_CREDIT_COST = 2;

export interface CoverLetterContext {
  userId: string;
  workspaceId: string;
  runId: string | null;
  resume: Resume;
  sections: ResumeSection[];
  jd: JobDescription;
}

export interface CoverLetterOpts {
  tone?: 'professional' | 'friendly' | 'confident' | 'enthusiastic';
  length?: 'short' | 'standard' | 'long';
}

@Injectable()
export class CoverLetterService {
  constructor(
    private readonly ai: AiService,
    private readonly chunker: ChunkerService,
    private readonly credits: CreditService,
    @InjectRepository(CoverLetter)
    private readonly letters: Repository<CoverLetter>,
    @InjectRepository(CompanyInsight)
    private readonly insights: Repository<CompanyInsight>,
    @InjectRepository(Workspace)
    private readonly workspaces: Repository<Workspace>,
    @InjectRepository(Resume)
    private readonly resumes: Repository<Resume>,
    @InjectRepository(ResumeSection)
    private readonly sections: Repository<ResumeSection>,
    @InjectRepository(JobDescription)
    private readonly jds: Repository<JobDescription>,
  ) {}

  async generate(
    ctx: CoverLetterContext,
    opts: CoverLetterOpts = {},
  ): Promise<CoverLetter> {
    // Company insights may or may not be ready — this step doesn't depend on it, so we
    // use it opportunistically. A letter with real company context is much better, but
    // waiting for it would serialise two steps that can run in parallel.
    const insight = await this.insights.findOne({
      where: { workspaceId: ctx.workspaceId },
    });

    const tone = opts.tone ?? 'professional';
    const length = opts.length ?? 'standard';

    const { data: out } = await this.ai.complete<CoverLetterOutput>({
      feature: 'cover_letter',
      promptKey: 'cover_letter',
      variables: {
        jd_summary: renderJdSummary(ctx.jd),
        resume_summary: this.renderResume(ctx.sections),
        company_context: insight
          ? `<company>${insight.overview}\nCulture: ${insight.culture.join('; ')}</company>`
          : '',
        tone,
        target_words: String(WORDS[length]),
      },
      truncateVariable: 'resume_summary',
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      runId: ctx.runId,
      stepName: 'generate_cover_letter',
    });

    // Placeholder check — a letter with "[Company Name]" in it is worse than none,
    // because the user might send it. AiService already converts every AI-layer
    // failure into an AppException before it reaches us; a post-hoc content check
    // failing here must be reported the same way, not as a raw Error.
    if (/\[[^\]]+\]/.test(out.content)) {
      throw Problems.aiOutputInvalid();
    }

    await this.letters.update(
      { workspaceId: ctx.workspaceId },
      { isCurrent: false },
    );
    const version = await this.nextVersion(ctx.workspaceId);
    return this.letters.save(
      this.letters.create({
        workspaceId: ctx.workspaceId,
        runId: ctx.runId,
        version,
        tone,
        length,
        content: out.content,
        wordCount: out.content.split(/\s+/).filter(Boolean).length,
        isCurrent: true,
      }),
    );
  }

  /**
   * Manual on-demand regeneration (outside the pipeline) — debits its own credits.
   *
   * Balance is checked BEFORE calling the AI (no point spending real OpenAI money on
   * a request that was always going to be rejected), and the debit itself happens
   * AFTER generate() succeeds — generate() can throw (AI_OUTPUT_INVALID from the
   * placeholder guard, a provider error, ...) and charging first would bill the user
   * for a letter they never got, with no compensating refund.
   */
  async regenerateForWorkspace(
    workspaceId: string,
    userId: string,
    opts: CoverLetterOpts = {},
  ): Promise<CoverLetter> {
    const balance = await this.credits.balance(userId);
    if (balance < REGENERATE_CREDIT_COST) {
      throw Problems.insufficientCredits(REGENERATE_CREDIT_COST, balance);
    }

    const ctx = await this.hydrate(workspaceId, userId);
    const letter = await this.generate(ctx, opts);
    await this.credits.debit(
      userId,
      REGENERATE_CREDIT_COST,
      'cover_letter_regenerate',
      workspaceId,
    );
    return letter;
  }

  async getCurrent(workspaceId: string, userId: string): Promise<CoverLetter> {
    const ws = await this.workspaces.findOne({
      where: { id: workspaceId, userId },
    });
    if (!ws) throw new NotFoundException();
    const letter = await this.letters.findOne({
      where: { workspaceId, isCurrent: true },
    });
    if (!letter) throw new NotFoundException();
    return letter;
  }

  private async hydrate(
    workspaceId: string,
    userId: string,
  ): Promise<CoverLetterContext> {
    const ws = await this.workspaces.findOne({
      where: { id: workspaceId, userId },
    });
    if (!ws) throw new NotFoundException();

    const resume = await this.resumes.findOne({ where: { id: ws.resumeId } });
    if (!resume) throw new NotFoundException();

    const jd = await this.jds.findOne({ where: { id: ws.jobDescriptionId } });
    if (!jd) throw new NotFoundException();

    const sections = await this.sections.find({
      where: { resumeId: resume.id, version: resume.currentVersion },
      order: { orderIndex: 'ASC' },
    });

    return { userId, workspaceId, runId: null, resume, sections, jd };
  }

  private async nextVersion(workspaceId: string): Promise<number> {
    const count = await this.letters.count({ where: { workspaceId } });
    return count + 1;
  }

  /** Reuses ChunkerService's per-section prose rendering rather than duplicating it. */
  private renderResume(sections: ResumeSection[]): string {
    return this.chunker
      .chunkResume(sections)
      .map((c) => c.content)
      .join('\n\n');
  }
}
