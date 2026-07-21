import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PipelineStep, PipelineContext, StepResult } from './step.interface';
import { STEP_MANIFEST } from './step-manifest';
import { ResumeParserService } from '../../resumes/services/resume-parser.service';
import { Resume } from '../../resumes/entities/resume.entity';
import { ResumeSection } from '../../resumes/entities/resume-section.entity';

const META = STEP_MANIFEST.parse_resume;

@Injectable()
export class ParseResumeStep extends PipelineStep {
  readonly name = 'parse_resume';
  readonly label = 'Reading your resume';
  readonly dependsOn = META.dependsOn;
  readonly progressWeight = META.progressWeight;
  readonly creditWeight = META.creditWeight;

  constructor(
    private readonly parser: ResumeParserService,
    @InjectRepository(Resume) private readonly resumes: Repository<Resume>,
    @InjectRepository(ResumeSection)
    private readonly sections: Repository<ResumeSection>,
  ) {
    super();
  }

  /**
   * WorkspacesService.analyze() already refuses to create a run unless the resume is
   * `parsed`, so in the normal flow this step is always a no-op skip — it exists as a
   * self-healing fallback (sections somehow missing) and to give the resume its own
   * slice of the progress bar and credit charge.
   */
  async shouldSkip(ctx: PipelineContext) {
    return ctx.resume.status === 'parsed' && ctx.sections.length > 0
      ? 'already parsed'
      : false;
  }

  async run(ctx: PipelineContext): Promise<StepResult> {
    await this.parser.parse(ctx.resume);
    await this.resumes.update(ctx.resume.id, {
      status: 'parsed',
      parseError: null,
    });
    ctx.sections = await this.sections.find({
      where: { resumeId: ctx.resume.id, version: ctx.resumeVersion },
      order: { orderIndex: 'ASC' },
    });
    return { outputRef: `resume_sections:${ctx.resume.id}` };
  }
}
