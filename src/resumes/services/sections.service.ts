import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResumeSection, SectionType } from '../entities/resume-section.entity';
import { Resume } from '../entities/resume.entity';
import { SECTION_SCHEMAS } from '../../ai/schemas/resume-sections.schema';
import { AppException, ErrorCode } from '../../common/exceptions/app.exception';

@Injectable()
export class SectionsService {
  constructor(
    @InjectRepository(ResumeSection)
    private readonly sections: Repository<ResumeSection>,
    @InjectRepository(Resume) private readonly resumes: Repository<Resume>,
  ) {}

  /** Same ownership pattern as ResumesService.findOwned: scoped WHERE, not fetch-then-compare. */
  private async assertOwned(resumeId: string, userId: string): Promise<void> {
    const resume = await this.resumes.findOne({
      where: { id: resumeId, userId },
      select: { id: true },
    });
    if (!resume) throw new NotFoundException();
  }

  async list(resumeId: string, userId: string): Promise<ResumeSection[]> {
    await this.assertOwned(resumeId, userId);
    return this.sections.find({
      where: { resumeId },
      order: { orderIndex: 'ASC' },
    });
  }

  async update(
    resumeId: string,
    userId: string,
    sectionType: string,
    content: unknown,
  ): Promise<ResumeSection> {
    await this.assertOwned(resumeId, userId);

    const schema = SECTION_SCHEMAS[sectionType as SectionType];
    if (!schema) throw new NotFoundException(); // not a real section type — no such resource

    const section = await this.sections.findOne({
      where: { resumeId, sectionType: sectionType as SectionType },
    });
    if (!section) throw new NotFoundException(); // resume hasn't been parsed yet, or was parsed before this section type existed

    const result = schema.safeParse(content);
    if (!result.success) {
      throw new AppException(
        ErrorCode.VALIDATION_FAILED,
        'Section content does not match the expected shape.',
        { issues: result.error.issues },
      );
    }

    section.content = result.data;
    section.editedByUser = true;
    return this.sections.save(section);
  }
}
