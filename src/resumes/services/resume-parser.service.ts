import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiService } from '../../ai/ai.service';
import { ResumeExtraction } from '../../ai/schemas/resume-extraction.schema';
import { ResumeSection, SectionType } from '../entities/resume-section.entity';
import { Resume } from '../entities/resume.entity';

@Injectable()
export class ResumeParserService {
  private readonly logger = new Logger(ResumeParserService.name);

  constructor(
    private readonly ai: AiService,
    @InjectRepository(ResumeSection)
    private readonly sectionRepo: Repository<ResumeSection>,
  ) {}

  async parse(resume: Resume): Promise<void> {
    if (!resume.rawText) {
      throw new Error(`Resume ${resume.id} has no extracted text to parse`);
    }

    const { data, usage } = await this.ai.complete<ResumeExtraction>({
      feature: 'resume_extraction',
      promptKey: 'resume_extraction',
      variables: { resume_text: resume.rawText },
      truncateVariable: 'resume_text',
      userId: resume.userId,
      runId: resume.id,
      stepName: 'extract',
    });

    await this.saveSections(resume.id, data);
    this.logger.log(
      `parsed resume ${resume.id}: ${usage.promptTokens}+${usage.completionTokens} tokens, $${usage.costUsd}`,
    );
  }

  private async saveSections(
    resumeId: string,
    data: ResumeExtraction,
  ): Promise<void> {
    const entries: Array<{
      type: SectionType;
      content: unknown;
      confidence: number;
    }> = [
      {
        type: 'personal_info',
        content: data.personalInfo,
        confidence: data.confidence.personalInfo,
      },
      {
        type: 'summary',
        content: data.summary,
        confidence: data.confidence.summary,
      },
      {
        type: 'skills',
        content: data.skills,
        confidence: data.confidence.skills,
      },
      {
        type: 'experience',
        content: data.experience,
        confidence: data.confidence.experience,
      },
      {
        type: 'projects',
        content: data.projects,
        confidence: data.confidence.projects,
      },
      {
        type: 'education',
        content: data.education,
        confidence: data.confidence.education,
      },
      {
        type: 'certifications',
        content: data.certifications,
        confidence: data.confidence.certifications,
      },
      {
        type: 'languages',
        content: data.languages,
        confidence: data.confidence.languages,
      },
    ];

    await this.sectionRepo.manager.transaction(async (m) => {
      // Only replaces AI-generated rows. A first parse has no rows at all, so this is a
      // no-op today; it's here so a future re-parse can't clobber a user's manual edits.
      await m.delete(ResumeSection, { resumeId, editedByUser: false });
      const rows = entries.map((entry, index) =>
        m.create(ResumeSection, {
          resumeId,
          sectionType: entry.type,
          content: entry.content,
          orderIndex: index,
          confidence: entry.confidence.toFixed(2),
          aiGenerated: true,
          editedByUser: false,
        }),
      );
      await m.save(rows);
    });
  }
}
