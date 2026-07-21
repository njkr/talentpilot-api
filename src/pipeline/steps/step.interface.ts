import { Resume } from '../../resumes/entities/resume.entity';
import { ResumeSection } from '../../resumes/entities/resume-section.entity';
import { JobDescription } from '../../job-descriptions/entities/job-description.entity';

export interface PipelineContext {
  runId: string;
  workspaceId: string;
  userId: string;
  resume: Resume;
  resumeVersion: number;
  sections: ResumeSection[];
  jd: JobDescription;
  /** Outputs of completed steps, keyed by step name. */
  artifacts: Map<string, unknown>;
}

export interface StepResult {
  outputRef?: string;
  /** Small payload streamed to the client immediately, e.g. { overallScore: 71 }. */
  preview?: unknown;
}

export abstract class PipelineStep {
  abstract readonly name: string;
  abstract readonly label: string; // shown in the UI timeline
  abstract readonly dependsOn: string[];

  /** Share of the progress bar. All steps' weights sum to 100. */
  abstract readonly progressWeight: number;

  /** Share of the credit charge — used for proportional refunds on failure. */
  abstract readonly creditWeight: number;

  /** Optional steps that fail mark the run `partial` instead of failing it. */
  readonly required: boolean = true;

  /** Return a reason string to skip (already done, cached), or false to run normally. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async shouldSkip(ctx: PipelineContext): Promise<string | false> {
    return false;
  }

  abstract run(ctx: PipelineContext): Promise<StepResult>;
}
