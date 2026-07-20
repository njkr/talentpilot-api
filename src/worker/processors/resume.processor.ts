import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Logger } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Job, Queue } from 'bullmq';
import { Resume } from 'src/resumes/entities/resume.entity';
import { StorageService } from 'src/storage/storage.service';
import { TextExtractorService } from 'src/resumes/services/text-extractor.service';
import { ResumeParserService } from 'src/resumes/services/resume-parser.service';
import { Env } from 'src/config/config.module';
import { AppException } from 'src/common/exceptions/app.exception';
import { Problems } from 'src/common/problems';

@Processor('resumes')
export class ResumeProcessor extends WorkerHost {
  private readonly logger = new Logger(ResumeProcessor.name);

  constructor(
    @InjectRepository(Resume) private readonly resumes: Repository<Resume>,
    @InjectQueue('resumes') private readonly queue: Queue,
    private readonly storage: StorageService,
    private readonly extractor: TextExtractorService,
    private readonly parser: ResumeParserService,
    private readonly env: Env,
  ) {
    super();
  }

  async process(job: Job<{ resumeId: string }>) {
    if (job.name === 'ai-parse') return this.processAiParse(job);
    return this.processExtractText(job);
  }

  private async processExtractText(job: Job<{ resumeId: string }>) {
    const resume = await this.resumes.findOne({
      where: { id: job.data.resumeId },
    });
    if (!resume) return; // deleted mid-flight — nothing to do

    await this.resumes.update(resume.id, { status: 'extracting' });

    try {
      const buf = await this.storage.get(resume.originalFileKey);
      const result = await this.extractor.extract(buf, resume.mimeType);

      // The scanned-PDF check. A photo of a resume yields ~0 characters: the text is
      // pixels, not glyphs. We can't parse that (OCR is a backlog item), so we fail
      // EARLY with a clear message rather than sending 12 characters to the AI and
      // returning a garbage resume the user won't understand.
      if (result.text.length < this.env.get('MIN_EXTRACTED_CHARS')) {
        await this.fail(resume, Problems.fileUnreadable().message);
        return;
      }

      await this.resumes.update(resume.id, {
        rawText: result.text,
        wordCount: result.wordCount,
        pageCount: result.pageCount ?? resume.pageCount,
        language: result.language,
        status: 'extracted',
        parseError: null,
      });

      await this.queue.add(
        'ai-parse',
        { resumeId: resume.id },
        {
          jobId: `ai-parse-${resume.id}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        },
      );
    } catch (err) {
      this.logger.error(
        `extraction failed for resume ${resume.id}`,
        err as Error,
      );

      // Only mark failed on the LAST attempt — attempts 1 and 2 should retry
      // (transient S3 blips are common and recoverable).
      if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
        await this.fail(resume, Problems.fileCorrupt().message);
      }
      throw err; // rethrow → BullMQ retries / dead-letters
    }
  }

  private async processAiParse(job: Job<{ resumeId: string }>) {
    const resume = await this.resumes.findOne({
      where: { id: job.data.resumeId },
    });
    if (!resume) return; // deleted mid-flight — nothing to do

    await this.resumes.update(resume.id, { status: 'parsing' });

    try {
      await this.parser.parse(resume);
      await this.resumes.update(resume.id, {
        status: 'parsed',
        parseError: null,
      });
    } catch (err) {
      this.logger.error(
        `AI parse failed for resume ${resume.id}`,
        err as Error,
      );

      // Budget/kill-switch/content-filter failures won't succeed on retry — fail fast
      // instead of burning BullMQ's attempt budget on something that can't self-resolve.
      const isTerminal =
        err instanceof AppException &&
        [
          'AI_BUDGET_EXCEEDED',
          'AI_CONTEXT_TOO_LONG',
          'AI_CONTENT_FILTERED',
        ].includes(err.code);

      if (isTerminal || job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
        const message =
          err instanceof AppException
            ? err.message
            : 'This resume could not be parsed. Try again shortly.';
        await this.fail(resume, message);
        if (isTerminal) return; // don't rethrow — BullMQ would otherwise keep retrying
      }
      throw err; // rethrow → BullMQ retries / dead-letters
    }
  }

  private async fail(resume: Resume, message: string) {
    await this.resumes.update(resume.id, {
      status: 'failed',
      parseError: message,
    });
  }
}
