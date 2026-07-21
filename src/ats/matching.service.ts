import { Injectable } from '@nestjs/common';
import { ResumesService } from '../resumes/resumes.service';
import { JobDescriptionsService } from '../job-descriptions/job-descriptions.service';
import { Problems } from '../common/problems';
import { MatchingFacade, MatchResult } from './matching.facade';

@Injectable()
export class MatchingService {
  constructor(
    private readonly resumes: ResumesService,
    private readonly jds: JobDescriptionsService,
    private readonly facade: MatchingFacade,
  ) {}

  async match(
    resumeId: string,
    jdId: string,
    userId: string,
  ): Promise<MatchResult> {
    const resume = await this.resumes.findOwned(resumeId, userId);
    if (resume.status !== 'parsed')
      throw Problems.resumeNotReady(resume.status);

    const jd = await this.jds.findOwned(jdId, userId);
    if (jd.status !== 'analyzed') throw Problems.jdNotReady(jd.status);

    return this.facade.prepare(resume, jd, userId);
  }
}
