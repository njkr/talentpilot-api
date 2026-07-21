import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PipelineRun } from './entities/pipeline-run.entity';
import { PipelineContext } from './steps/step.interface';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { Resume } from '../resumes/entities/resume.entity';
import { ResumeSection } from '../resumes/entities/resume-section.entity';
import { JobDescription } from '../job-descriptions/entities/job-description.entity';

/** Loads everything a run's steps need out of a bare PipelineRun row. */
@Injectable()
export class ContextHydrator {
  constructor(
    @InjectRepository(Workspace)
    private readonly workspaces: Repository<Workspace>,
    @InjectRepository(Resume) private readonly resumes: Repository<Resume>,
    @InjectRepository(ResumeSection)
    private readonly sections: Repository<ResumeSection>,
    @InjectRepository(JobDescription)
    private readonly jds: Repository<JobDescription>,
  ) {}

  async hydrate(run: PipelineRun): Promise<PipelineContext> {
    const workspace = await this.workspaces.findOne({
      where: { id: run.workspaceId },
    });
    if (!workspace)
      throw new NotFoundException(`Workspace ${run.workspaceId} not found`);

    const resume = await this.resumes.findOne({
      where: { id: workspace.resumeId },
    });
    if (!resume)
      throw new NotFoundException(`Resume ${workspace.resumeId} not found`);

    const jd = await this.jds.findOne({
      where: { id: workspace.jobDescriptionId },
    });
    if (!jd)
      throw new NotFoundException(
        `Job description ${workspace.jobDescriptionId} not found`,
      );

    // Sections for the version being analyzed — may be empty pre-parse; ParseResumeStep
    // fills ctx.sections itself once it has actually parsed the resume.
    const sections = await this.sections.find({
      where: { resumeId: resume.id, version: run.resumeVersion },
      order: { orderIndex: 'ASC' },
    });

    return {
      runId: run.id,
      workspaceId: run.workspaceId,
      userId: run.userId,
      resume,
      resumeVersion: run.resumeVersion,
      sections,
      jd,
      artifacts: new Map(),
    };
  }
}
