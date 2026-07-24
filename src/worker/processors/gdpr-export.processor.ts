import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { In, Repository } from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { Profile } from '../../profiles/entities/profile.entity';
import { Resume } from '../../resumes/entities/resume.entity';
import { ResumeSection } from '../../resumes/entities/resume-section.entity';
import { JobDescription } from '../../job-descriptions/entities/job-description.entity';
import { Workspace } from '../../workspaces/entities/workspace.entity';
import { AtsReport } from '../../ats/entities/ats-report.entity';
import { CoverLetter } from '../../cover-letter/entities/cover-letter.entity';
import { InterviewQuestion } from '../../interview/entities/interview-question.entity';
import { CompanyInsight } from '../../company/entities/company-insight.entity';
import { SalaryEstimate } from '../../salary/entities/salary-estimate.entity';
import { LearningRoadmap } from '../../learning-roadmap/entities/learning-roadmap.entity';
import { CreditLedger } from '../../credits/entities/credit-ledger.entity';
import { Subscription } from '../../payments/entities/subscription.entity';
import { StorageService } from '../../storage/storage.service';
import { NotificationsService } from '../../notifications/notifications.service';

/**
 * The heavy, multi-table collection work for a GDPR export runs here (worker-side),
 * not synchronously in the request — same reasoning as every other slow job in this
 * app (documents, pipeline analysis): the API responds immediately with "queued" and
 * the user is notified once the file actually exists.
 */
@Injectable()
@Processor('gdpr', { concurrency: 1 })
export class GdprExportProcessor extends WorkerHost {
  private readonly logger = new Logger(GdprExportProcessor.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(Resume) private readonly resumes: Repository<Resume>,
    @InjectRepository(ResumeSection)
    private readonly sections: Repository<ResumeSection>,
    @InjectRepository(JobDescription)
    private readonly jobDescriptions: Repository<JobDescription>,
    @InjectRepository(Workspace)
    private readonly workspaces: Repository<Workspace>,
    @InjectRepository(AtsReport)
    private readonly atsReports: Repository<AtsReport>,
    @InjectRepository(CoverLetter)
    private readonly coverLetters: Repository<CoverLetter>,
    @InjectRepository(InterviewQuestion)
    private readonly interviewQuestions: Repository<InterviewQuestion>,
    @InjectRepository(CompanyInsight)
    private readonly companyInsights: Repository<CompanyInsight>,
    @InjectRepository(SalaryEstimate)
    private readonly salaryEstimates: Repository<SalaryEstimate>,
    @InjectRepository(LearningRoadmap)
    private readonly roadmaps: Repository<LearningRoadmap>,
    @InjectRepository(CreditLedger)
    private readonly creditLedger: Repository<CreditLedger>,
    @InjectRepository(Subscription)
    private readonly subscriptions: Repository<Subscription>,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {
    super();
  }

  async process(job: Job<{ userId: string }>): Promise<void> {
    const { userId } = job.data;
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      this.logger.warn(`gdpr export requested for missing user ${userId}`);
      return;
    }

    const workspaceIds = (
      await this.workspaces.find({ where: { userId }, select: { id: true } })
    ).map((w) => w.id);
    const resumeIds = (
      await this.resumes.find({ where: { userId }, select: { id: true } })
    ).map((r) => r.id);

    const [
      profile,
      resumes,
      sections,
      jobDescriptions,
      workspaces,
      atsReports,
      coverLetters,
      interviewQuestions,
      companyInsights,
      salaryEstimates,
      roadmaps,
      creditLedger,
      subscription,
    ] = await Promise.all([
      this.profiles.findOne({ where: { userId } }),
      this.resumes.find({ where: { userId } }),
      resumeIds.length
        ? this.sections.find({ where: { resumeId: In(resumeIds) } })
        : Promise.resolve([]),
      this.jobDescriptions.find({ where: { userId } }),
      this.workspaces.find({ where: { userId } }),
      workspaceIds.length
        ? this.atsReports.find({ where: { workspaceId: In(workspaceIds) } })
        : Promise.resolve([]),
      workspaceIds.length
        ? this.coverLetters.find({ where: { workspaceId: In(workspaceIds) } })
        : Promise.resolve([]),
      workspaceIds.length
        ? this.interviewQuestions.find({
            where: { workspaceId: In(workspaceIds) },
          })
        : Promise.resolve([]),
      workspaceIds.length
        ? this.companyInsights.find({
            where: { workspaceId: In(workspaceIds) },
          })
        : Promise.resolve([]),
      workspaceIds.length
        ? this.salaryEstimates.find({
            where: { workspaceId: In(workspaceIds) },
          })
        : Promise.resolve([]),
      workspaceIds.length
        ? this.roadmaps.find({ where: { workspaceId: In(workspaceIds) } })
        : Promise.resolve([]),
      this.creditLedger.find({ where: { userId } }),
      this.subscriptions.findOne({ where: { userId } }),
    ]);

    const payload = {
      exportedAt: new Date().toISOString(),
      account: { id: user.id, email: user.email, createdAt: user.createdAt },
      profile,
      resumes: resumes.map((r) => ({
        ...r,
        sections: sections.filter((s) => s.resumeId === r.id),
      })),
      jobDescriptions,
      workspaces,
      atsReports,
      coverLetters,
      interviewQuestions,
      companyInsights,
      salaryEstimates,
      learningRoadmaps: roadmaps,
      creditLedger,
      subscription,
    };

    const key = `users/${userId}/gdpr-exports/${Date.now()}.json`;
    const buffer = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
    await this.storage.put(key, buffer, 'application/json');
    const url = await this.storage.getSignedUrl(
      key,
      'talentpilot-data-export.json',
    );

    await this.notifications.create(userId, {
      type: 'gdpr.export_ready',
      title: 'Your data export is ready',
      message: `Your requested data export is ready to download. This link expires shortly: ${url}`,
      data: { key },
    });
  }
}
