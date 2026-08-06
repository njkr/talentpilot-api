import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { Resume } from '../resumes/entities/resume.entity';
import { ResumeSection } from '../resumes/entities/resume-section.entity';
import { JobDescription } from '../job-descriptions/entities/job-description.entity';
import { MatchingFacade } from './matching.facade';
import { AtsService } from './ats.service';
import { PipelineContext } from '../pipeline/steps/step.interface';

export interface RescoreJobData {
  workspaceId: string;
  userId: string;
}

/**
 * Worker-side only (touches embeddings/AI, same boundary every pipeline step keeps
 * out of the API process — see WorkspacesModule's own comment on this). A separate
 * queue/processor from 'pipeline' rather than overloading PipelineProcessor: a rescore
 * doesn't create a PipelineRun/PipelineStep row or run the full 12-step DAG, it's a
 * single, much smaller "score this resume against this JD again" operation —
 * MatchingFacade.prepare() + AtsService.generate() are the whole job.
 */
@Processor('rescore', { concurrency: 5 })
export class RescoreProcessor extends WorkerHost {
  constructor(
    private readonly facade: MatchingFacade,
    private readonly ats: AtsService,
    @InjectRepository(Workspace)
    private readonly workspaces: Repository<Workspace>,
    @InjectRepository(Resume) private readonly resumes: Repository<Resume>,
    @InjectRepository(ResumeSection)
    private readonly sections: Repository<ResumeSection>,
    @InjectRepository(JobDescription)
    private readonly jds: Repository<JobDescription>,
  ) {
    super();
  }

  async process(job: Job<RescoreJobData>) {
    const { workspaceId, userId } = job.data;
    const ws = await this.workspaces.findOneOrFail({
      where: { id: workspaceId },
    });
    const resume = await this.resumes.findOneOrFail({
      where: { id: ws.resumeId },
    });
    const jd = await this.jds.findOneOrFail({
      where: { id: ws.jobDescriptionId },
    });
    const sections = await this.sections.find({
      where: { resumeId: resume.id, version: resume.currentVersion },
    });

    // Re-embeds only the resume side; embedOwner() skips chunks unchanged since the
    // last score, so an unrelated section (e.g. skills, if only experience changed)
    // isn't re-embedded for nothing. The JD side is always a no-op re-check — its
    // content never changes between the original analysis and a rescore.
    const match = await this.facade.prepare(resume, jd, userId);

    const ctx: PipelineContext = {
      runId: ws.lastRunId ?? workspaceId,
      workspaceId,
      userId,
      resume,
      resumeVersion: resume.currentVersion,
      sections,
      jd,
      artifacts: new Map(),
    };
    await this.ats.generate(ctx, match);
  }
}
