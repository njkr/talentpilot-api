import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { JobDescription } from './entities/job-description.entity';
import { JdAnalysis } from '../ai/schemas/jd-analysis.schema';
import { AiService } from '../ai/ai.service';
import { TextExtractorService } from '../resumes/services/text-extractor.service';
import { FileValidatorService } from '../resumes/services/file-validator.service';
import { AppException } from '../common/exceptions/app.exception';
import { Problems } from '../common/problems';
import { CursorQueryDto } from '../common/dto/cursor-query.dto';
import { decodeCursor, encodeCursor } from '../common/utils/cursor.util';

const MIN_JD_CHARS = 100;

// Built via the RegExp constructor from escaped code points (rather than a character-class
// literal) so no literal control/zero-width bytes ever sit in this source file — same
// reasoning as TextExtractorService.
const CONTROL_AND_ZERO_WIDTH_CHARS = new RegExp(
  '[\u0000-\u0008\u000B\u000C\u000E-\u001F\u200B-\u200D\uFEFF]',
  'g',
);
const NON_BREAKING_SPACE = new RegExp('\u00A0', 'g');

@Injectable()
export class JobDescriptionsService {
  constructor(
    @InjectRepository(JobDescription)
    private readonly jds: Repository<JobDescription>,
    private readonly ai: AiService,
    private readonly extractor: TextExtractorService,
    private readonly validator: FileValidatorService,
  ) {}

  async paste(
    userId: string,
    text: string,
    position?: string,
    company?: string,
  ): Promise<JobDescription> {
    return this.ingest(userId, text, 'paste', position, company);
  }

  async upload(
    userId: string,
    file: Express.Multer.File,
  ): Promise<JobDescription> {
    const { mime } = await this.validator.validate(file);
    const { text } = await this.extractor.extract(file.buffer, mime);
    return this.ingest(userId, text, 'upload');
  }

  private async ingest(
    userId: string,
    raw: string,
    source: JobDescription['source'],
    position?: string,
    company?: string,
  ): Promise<JobDescription> {
    const text = this.normalize(raw);
    if (text.length < MIN_JD_CHARS) throw Problems.jdTooShort();

    // Users paste the same JD repeatedly while iterating on a resume. Reusing the
    // analysed row saves an AI call and keeps their JD list from filling with duplicates.
    const contentHash = createHash('sha256').update(text).digest('hex');
    const existing = await this.jds.findOne({
      where: { userId, contentHash, status: 'analyzed' },
    });
    if (existing) return existing;

    const jd = await this.jds.save(
      this.jds.create({
        userId,
        descriptionRaw: text,
        contentHash,
        source,
        position: position ?? 'Untitled position',
        company: company ?? null,
        status: 'pending',
      }),
    );

    // Analysed inline, not queued: the jd_analysis prompt on 4o-mini takes a few
    // seconds and the user is sitting on the UI waiting for it — queueing would mean
    // building a progress UI for a 3-second operation.
    return this.analyse(jd);
  }

  async analyse(jd: JobDescription): Promise<JobDescription> {
    await this.jds.update(jd.id, { status: 'analyzing' });
    try {
      const { data } = await this.ai.complete<JdAnalysis>({
        feature: 'jd_analysis',
        promptKey: 'jd_analysis',
        variables: { jd_text: jd.descriptionRaw },
        truncateVariable: 'jd_text',
        userId: jd.userId,
        runId: jd.id,
        stepName: 'analyze',
      });

      await this.jds.update(jd.id, {
        parsedData: data,
        // Promote the useful fields to columns so listing/filtering doesn't need jsonb ops.
        company: data.company ?? jd.company,
        position: data.position || jd.position,
        employmentType: data.employmentType,
        location: data.location,
        remoteType: data.remoteType === 'unknown' ? null : data.remoteType,
        experienceRequired: data.experienceRequired,
        salaryMin: data.salary.min,
        salaryMax: data.salary.max,
        salaryCurrency: data.salary.currency?.slice(0, 3) ?? null,
        status: 'analyzed',
        parseError: null,
      });
      return this.findOwned(jd.id, jd.userId);
    } catch (err) {
      const message =
        err instanceof AppException
          ? err.message
          : 'Something went wrong analysing this job description.';
      await this.jds.update(jd.id, { status: 'failed', parseError: message });
      throw err;
    }
  }

  async list(userId: string, q: CursorQueryDto) {
    const after = decodeCursor(q.cursor);
    const qb = this.jds
      .createQueryBuilder('j')
      .where('j.user_id = :userId', { userId })
      .orderBy('j.created_at', 'DESC')
      .addOrderBy('j.id', 'DESC')
      .take(q.limit + 1);
    if (after) {
      qb.andWhere('(j.created_at, j.id) < (:c, :i)', {
        c: after.createdAt,
        i: after.id,
      });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > q.limit;
    const data = hasMore ? rows.slice(0, q.limit) : rows;
    return {
      data,
      hasMore,
      nextCursor: hasMore ? encodeCursor(data.at(-1)!) : null,
    };
  }

  /** Ownership via scoped WHERE, not fetch-then-compare — a foreign id 404s, never 403. */
  async findOwned(id: string, userId: string): Promise<JobDescription> {
    const jd = await this.jds.findOne({ where: { id, userId } });
    if (!jd) throw new NotFoundException();
    return jd;
  }

  async remove(id: string, userId: string): Promise<void> {
    await this.findOwned(id, userId);
    await this.jds.softDelete(id);
  }

  /** Re-run analysis after a `failed` status — same dedupe row, fresh AI call. */
  async retry(id: string, userId: string): Promise<JobDescription> {
    const jd = await this.findOwned(id, userId);
    if (jd.status !== 'failed') return jd;
    return this.analyse(jd);
  }

  /** Same normalization as resumes — a JD copied from a job board carries a lot of junk. */
  private normalize(text: string): string {
    return text
      .normalize('NFKC')
      .replace(/\r\n?/g, '\n')
      .replace(CONTROL_AND_ZERO_WIDTH_CHARS, '')
      .replace(NON_BREAKING_SPACE, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}
