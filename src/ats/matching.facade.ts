import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Resume } from '../resumes/entities/resume.entity';
import { ResumeSection } from '../resumes/entities/resume-section.entity';
import { JobDescription } from '../job-descriptions/entities/job-description.entity';
import { ChunkerService } from '../embeddings/services/chunker.service';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import {
  SemanticScorerService,
  SemanticScoreResult,
} from './services/semantic-scorer.service';
import {
  KeywordMatcherService,
  KeywordMatch,
} from './services/keyword-matcher.service';

export interface MatchResult {
  semantic: SemanticScoreResult;
  keywords: KeywordMatch[];
  stats: {
    resume: { embedded: number; reused: number };
    jd: { embedded: number; reused: number };
  };
}

/**
 * What a later matching pipeline calls to score one resume against one JD. Embeds both
 * sides (skipping unchanged chunks), runs the semantic + keyword passes, and returns
 * everything a UI needs to render the result.
 */
@Injectable()
export class MatchingFacade {
  constructor(
    @InjectRepository(ResumeSection)
    private readonly sectionRepo: Repository<ResumeSection>,
    private readonly chunker: ChunkerService,
    private readonly embeddings: EmbeddingsService,
    private readonly scorer: SemanticScorerService,
    private readonly keywords: KeywordMatcherService,
  ) {}

  async prepare(
    resume: Resume,
    jd: JobDescription,
    userId: string,
  ): Promise<MatchResult> {
    const sections = await this.sectionRepo.find({
      where: { resumeId: resume.id },
      order: { orderIndex: 'ASC' },
    });

    // Both sides embed in parallel — independent network round-trips.
    const [resumeStats, jdStats] = await Promise.all([
      this.embeddings.embedOwner(
        'resume',
        resume.id,
        resume.currentVersion,
        this.chunker.chunkResume(sections),
        userId,
      ),
      this.embeddings.embedOwner(
        'job_description',
        jd.id,
        1,
        this.chunker.chunkJd(jd),
        userId,
      ),
    ]);

    const matches = await this.embeddings.matchRequirements(
      resume.id,
      resume.currentVersion,
      jd.id,
    );
    const semantic = this.scorer.score(matches);
    const keywordMatches = await this.keywords.match(
      jd,
      sections,
      resume.rawText ?? '',
      userId,
    );

    return {
      semantic,
      keywords: keywordMatches,
      stats: { resume: resumeStats, jd: jdStats },
    };
  }
}
