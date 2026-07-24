import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import {
  DocType,
  GeneratedDocument,
} from '../../documents/entities/generated-document.entity';
import { Workspace } from '../../workspaces/entities/workspace.entity';
import { ResumeSection } from '../../resumes/entities/resume-section.entity';
import { Profile } from '../../profiles/entities/profile.entity';
import { CoverLetter } from '../../cover-letter/entities/cover-letter.entity';
import { AtsReport } from '../../ats/entities/ats-report.entity';
import { AiSuggestion } from '../../suggestions/entities/ai-suggestion.entity';
import { InterviewQuestion } from '../../interview/entities/interview-question.entity';
import { CompanyInsight } from '../../company/entities/company-insight.entity';
import { SalaryEstimate } from '../../salary/entities/salary-estimate.entity';
import { LearningRoadmap } from '../../learning-roadmap/entities/learning-roadmap.entity';
import { ResumeDocxGenerator } from '../../documents/generators/resume-docx.generator';
import { CoverLetterDocxGenerator } from '../../documents/generators/cover-letter-docx.generator';
import { PdfService } from '../../documents/services/pdf.service';
import { TemplateService } from '../../documents/services/template.service';
import { StorageService } from '../../storage/storage.service';

interface PersonalInfo {
  fullName: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  links: { label: string; url: string }[];
}

@Injectable()
@Processor('documents', { concurrency: 2 }) // Puppeteer is memory-heavy; 2 is plenty
export class DocumentsProcessor extends WorkerHost {
  private readonly logger = new Logger(DocumentsProcessor.name);

  constructor(
    @InjectRepository(GeneratedDocument)
    private readonly docs: Repository<GeneratedDocument>,
    @InjectRepository(Workspace)
    private readonly workspaces: Repository<Workspace>,
    @InjectRepository(ResumeSection)
    private readonly sections: Repository<ResumeSection>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(CoverLetter)
    private readonly letters: Repository<CoverLetter>,
    @InjectRepository(AtsReport)
    private readonly reports: Repository<AtsReport>,
    @InjectRepository(AiSuggestion)
    private readonly suggestions: Repository<AiSuggestion>,
    @InjectRepository(InterviewQuestion)
    private readonly questions: Repository<InterviewQuestion>,
    @InjectRepository(CompanyInsight)
    private readonly companyInsights: Repository<CompanyInsight>,
    @InjectRepository(SalaryEstimate)
    private readonly salaryEstimates: Repository<SalaryEstimate>,
    @InjectRepository(LearningRoadmap)
    private readonly roadmaps: Repository<LearningRoadmap>,
    private readonly docxGen: ResumeDocxGenerator,
    private readonly coverLetterDocxGen: CoverLetterDocxGenerator,
    private readonly pdf: PdfService,
    private readonly templates: TemplateService,
    private readonly storage: StorageService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    super();
  }

  async process(job: Job<{ documentId: string }>) {
    const doc = await this.docs.findOneOrFail({
      where: { id: job.data.documentId },
    });
    await this.docs.update(doc.id, { status: 'generating' });

    try {
      const buffer = await this.build(doc);
      const key = `users/${doc.userId}/workspaces/${doc.workspaceId}/${doc.id}/${doc.filename}`;
      await this.storage.put(key, buffer, this.mimeFor(doc.type));

      await this.docs.update(doc.id, {
        fileKey: key,
        fileSize: buffer.length,
        status: 'ready',
        error: null,
      });
      this.eventEmitter.emit('document.ready', { documentId: doc.id });
    } catch (err) {
      const attemptsMade = job.attemptsMade + 1;
      const maxAttempts = job.opts.attempts ?? 1;
      if (attemptsMade >= maxAttempts) {
        await this.docs.update(doc.id, {
          status: 'failed',
          error: 'We could not generate this document. Please try again.',
        });
        this.logger.error(
          `document ${doc.id} (${doc.type}) failed permanently: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      throw err;
    }
  }

  private async build(doc: GeneratedDocument): Promise<Buffer> {
    const ws = await this.workspaces.findOneOrFail({
      where: { id: doc.workspaceId },
      relations: { resume: true, jobDescription: true },
    });

    switch (doc.type) {
      case 'resume_docx':
        return this.buildResumeDocx(doc, ws);
      case 'resume_pdf':
        return this.buildResumePdf(doc, ws);
      case 'cover_letter_pdf':
        return this.buildCoverLetterPdf(doc, ws);
      case 'cover_letter_docx':
        return this.buildCoverLetterDocx(doc, ws);
      case 'full_report_pdf':
        return this.buildFullReportPdf(doc, ws);
      default:
        throw new Error(`Unknown document type: ${doc.type}`);
    }
  }

  private async sectionsFor(
    resumeId: string,
    version: number,
  ): Promise<ResumeSection[]> {
    return this.sections.find({
      where: { resumeId, version },
      order: { orderIndex: 'ASC' },
    });
  }

  private toResumeTemplateData(
    sections: ResumeSection[],
    fallbackName: string,
  ) {
    const byType = new Map(sections.map((s) => [s.sectionType, s.content]));
    const info = (byType.get('personal_info') as PersonalInfo | undefined) ?? {
      fullName: null,
      email: null,
      phone: null,
      location: null,
      links: [],
    };
    const summary = byType.get('summary') as
      | { text: string | null }
      | undefined;
    return {
      fullName: info.fullName ?? fallbackName,
      email: info.email,
      phone: info.phone,
      location: info.location,
      links: info.links ?? [],
      summary: summary?.text ?? null,
      skills: (byType.get('skills') as string[] | undefined) ?? [],
      experience: byType.get('experience') ?? [],
      projects: byType.get('projects') ?? [],
      education: byType.get('education') ?? [],
      certifications: byType.get('certifications') ?? [],
    };
  }

  private async buildResumeDocx(
    doc: GeneratedDocument,
    ws: Workspace,
  ): Promise<Buffer> {
    const sections = await this.sectionsFor(ws.resumeId, doc.resumeVersion!);
    return this.docxGen.generate(sections, ws.resume.title);
  }

  private async buildResumePdf(
    doc: GeneratedDocument,
    ws: Workspace,
  ): Promise<Buffer> {
    const sections = await this.sectionsFor(ws.resumeId, doc.resumeVersion!);
    // Same template data shape a frontend preview would bind to — so what the user
    // saw is exactly what they download. Two representations of the same resume
    // always drift eventually.
    const data = this.toResumeTemplateData(sections, ws.resume.title);
    return this.pdf.render(this.templates.render('resume', data));
  }

  private async buildCoverLetterPdf(
    doc: GeneratedDocument,
    ws: Workspace,
  ): Promise<Buffer> {
    const letter = await this.letters.findOne({
      where: { workspaceId: doc.workspaceId, isCurrent: true },
    });
    if (!letter)
      throw new NotFoundException('No cover letter for this workspace');

    const profile = await this.profiles.findOne({
      where: { userId: doc.userId },
    });
    const sections = await this.sectionsFor(
      ws.resumeId,
      ws.resume.currentVersion,
    );
    const info = this.toResumeTemplateData(sections, ws.resume.title);

    return this.pdf.render(
      this.templates.render('cover-letter', {
        fullName:
          [profile?.firstName, profile?.lastName].filter(Boolean).join(' ') ||
          info.fullName,
        email: info.email,
        phone: profile?.phone ?? info.phone,
        date: new Date().toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
        position: ws.jobDescription.position,
        company: ws.jobDescription.company,
        paragraphs: letter.content.split(/\n\s*\n/).filter(Boolean),
      }),
    );
  }

  private async buildCoverLetterDocx(
    doc: GeneratedDocument,
    ws: Workspace,
  ): Promise<Buffer> {
    const letter = await this.letters.findOne({
      where: { workspaceId: doc.workspaceId, isCurrent: true },
    });
    if (!letter)
      throw new NotFoundException('No cover letter for this workspace');

    const profile = await this.profiles.findOne({
      where: { userId: doc.userId },
    });
    const sections = await this.sectionsFor(
      ws.resumeId,
      ws.resume.currentVersion,
    );
    const info = this.toResumeTemplateData(sections, ws.resume.title);

    return this.coverLetterDocxGen.generate({
      fullName:
        [profile?.firstName, profile?.lastName].filter(Boolean).join(' ') ||
        info.fullName,
      email: info.email,
      phone: profile?.phone ?? info.phone,
      date: new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
      position: ws.jobDescription.position,
      company: ws.jobDescription.company,
      paragraphs: letter.content.split(/\n\s*\n/).filter(Boolean),
    });
  }

  private async buildFullReportPdf(
    doc: GeneratedDocument,
    ws: Workspace,
  ): Promise<Buffer> {
    const [report, letter, questions, companyInsight, salaryEstimate, roadmap] =
      await Promise.all([
        this.reports.findOne({ where: { workspaceId: doc.workspaceId } }),
        this.letters.findOne({
          where: { workspaceId: doc.workspaceId, isCurrent: true },
        }),
        this.questions.find({ where: { workspaceId: doc.workspaceId } }),
        this.companyInsights.findOne({
          where: { workspaceId: doc.workspaceId },
        }),
        this.salaryEstimates.findOne({
          where: { workspaceId: doc.workspaceId },
        }),
        this.roadmaps.findOne({ where: { workspaceId: doc.workspaceId } }),
      ]);

    const suggestions = report
      ? await this.suggestions.find({
          where: { workspaceId: doc.workspaceId, status: 'accepted' },
        })
      : [];

    return this.pdf.render(
      this.templates.render('report', {
        workspaceName: ws.name,
        position: ws.jobDescription.position,
        company: ws.jobDescription.company,
        atsReport: report,
        suggestions,
        coverLetter: letter
          ? { paragraphs: letter.content.split(/\n\s*\n/).filter(Boolean) }
          : null,
        interviewQuestions: questions,
        companyInsight,
        salaryEstimate,
        learningRoadmap: roadmap,
      }),
    );
  }

  private mimeFor(type: DocType): string {
    switch (type) {
      case 'resume_docx':
      case 'cover_letter_docx':
        return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      default:
        return 'application/pdf';
    }
  }
}
