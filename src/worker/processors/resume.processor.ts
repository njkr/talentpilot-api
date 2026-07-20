import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Logger } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import { Resume } from 'src/resumes/entities/resume.entity';
import { StorageService } from 'src/storage/storage.service';
import { TextExtractorService } from 'src/resumes/services/text-extractor.service';
import { Env } from 'src/config/config.module';
import { Problems } from 'src/common/problems';

@Processor('resumes')
export class ResumeProcessor extends WorkerHost {
  private readonly logger = new Logger(ResumeProcessor.name);

  constructor(
    @InjectRepository(Resume) private readonly resumes: Repository<Resume>,
    private readonly storage: StorageService,
    private readonly extractor: TextExtractorService,
    private readonly env: Env,
  ) {
    super();
  }

  async process(job: Job<{ resumeId: string }>) {
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

      // AI parsing lands in a later sprint. Deliberately NOT enqueuing anything here yet:
      // this processor only knows how to extract text, and a same-queue 'ai-parse' job
      // would be picked up by this same process() and mis-handled as another extraction.
      // When AI parsing exists, give it its own queue (or branch on job.name here).
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

  private async fail(resume: Resume, message: string) {
    await this.resumes.update(resume.id, {
      status: 'failed',
      parseError: message,
    });
  }
}
