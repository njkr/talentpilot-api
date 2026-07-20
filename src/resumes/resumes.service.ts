import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Not, Repository } from 'typeorm';
import { createHash } from 'crypto';
import { Resume } from './entities/resume.entity';
import { Workspace } from 'src/workspaces/entities/workspace.entity';
import { StorageService } from 'src/storage/storage.service';
import { FileValidatorService } from './services/file-validator.service';
import { PlanLimitService } from 'src/subscriptions/plan-limit.service';
import { Env } from 'src/config/config.module';
import { Problems } from 'src/common/problems';
import { User } from 'src/auth/entities/user.entity';
import { CursorQueryDto } from 'src/common/dto/cursor-query.dto';
import { decodeCursor, encodeCursor } from 'src/common/utils/cursor.util';

const LIST_COLUMNS = [
  'r.id',
  'r.title',
  'r.status',
  'r.pageCount',
  'r.wordCount',
  'r.fileSize',
  'r.language',
  'r.parseError',
  'r.createdAt',
] as const;

@Injectable()
export class ResumesService {
  constructor(
    @InjectRepository(Resume) private readonly resumes: Repository<Resume>,
    @InjectRepository(Workspace)
    private readonly workspaces: Repository<Workspace>,
    private readonly storage: StorageService,
    private readonly validator: FileValidatorService,
    private readonly plans: PlanLimitService,
    @InjectQueue('resumes') private readonly queue: Queue,
    private readonly events: EventEmitter2,
    private readonly env: Env,
  ) {}

  async upload(user: User, file: Express.Multer.File): Promise<Resume> {
    // 1. Plan limit BEFORE doing any work — no point uploading then rejecting.
    await this.plans.assertCanCreateResume(user.id);

    // 2. Magic-byte validation.
    const { ext, mime } = await this.validator.validate(file);

    // 3. Page guard for PDFs — reject the 400-page monster before it reaches the worker.
    if (ext === 'pdf') {
      const pages = this.validator.countPdfPages(file.buffer);
      const max = this.env.get('MAX_RESUME_PAGES');
      if (pages > max) throw Problems.fileTooManyPages(pages, max);
    }

    // 4. Content dedupe. Uploading the same file twice is common (users re-upload after
    //    a failed parse). Returning the existing row saves an AI parse and, more
    //    importantly, avoids a confusing duplicate in their list.
    const contentHash = createHash('sha256').update(file.buffer).digest('hex');
    const existing = await this.resumes.findOne({
      where: { userId: user.id, contentHash, status: Not('failed') },
    });
    if (existing) return existing;

    // 5. Create the row FIRST — we need its id for the storage key, and a row with no file
    //    is recoverable (a janitor can clean it) while a file with no row is an orphan
    //    nobody will ever find or bill for.
    const resume = await this.resumes.save(
      this.resumes.create({
        userId: user.id,
        title: this.cleanTitle(file.originalname),
        originalFilename: file.originalname.slice(0, 255),
        originalFileKey: '', // filled in below
        mimeType: mime,
        fileSize: file.size,
        contentHash,
        status: 'uploaded',
      }),
    );

    // 6. Store the bytes.
    try {
      const key = this.storage.resumeKey(user.id, resume.id, ext);
      await this.storage.put(key, file.buffer, mime);
      resume.originalFileKey = key;
      await this.resumes.save(resume);
    } catch (e) {
      // Storage failed → don't leave a half-created resume in the user's list.
      await this.resumes.delete(resume.id);
      throw e;
    }

    // 7. Hand off to the worker. Returns immediately — the API does NOT parse.
    await this.queue.add(
      'extract-text',
      { resumeId: resume.id },
      {
        jobId: `extract-${resume.id}`, // dedupes if this somehow fires twice; BullMQ rejects ':' in custom ids
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    );

    this.events.emit('resume.uploaded', { resume, userId: user.id });
    return resume; // status: 'uploaded' — frontend polls or waits
  }

  private cleanTitle(filename: string) {
    return (
      filename
        .replace(/\.(pdf|docx)$/i, '')
        .replace(/[_-]+/g, ' ')
        .trim()
        .slice(0, 200) || 'Untitled resume'
    );
  }

  // ── list (cursor pagination) ──
  async list(userId: string, q: CursorQueryDto) {
    const after = decodeCursor(q.cursor);
    const qb = this.resumes
      .createQueryBuilder('r')
      .where('r.user_id = :userId', { userId })
      // rawText is a big text column — never select it in a list query.
      .select(LIST_COLUMNS as unknown as string[])
      .orderBy('r.created_at', 'DESC')
      .addOrderBy('r.id', 'DESC')
      .take(q.limit + 1);
    if (after) {
      qb.andWhere('(r.created_at, r.id) < (:c, :i)', {
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

  /**
   * Ownership is enforced by putting userId in the WHERE clause, not by fetching then
   * comparing. Same query count, and it's impossible to forget the check.
   * A foreign id returns 404, not 403 — 403 confirms the resource exists (enumeration).
   */
  async findOwned(id: string, userId: string): Promise<Resume> {
    const resume = await this.resumes.findOne({ where: { id, userId } });
    if (!resume) throw new NotFoundException();
    return resume;
  }

  async rename(id: string, userId: string, title: string) {
    const resume = await this.findOwned(id, userId);
    resume.title = title;
    return this.resumes.save(resume);
  }

  // ── delete: blocked if in use ──
  async remove(id: string, userId: string) {
    await this.findOwned(id, userId); // 404s if this id isn't owned by userId

    // Don't cascade-delete workspaces — a workspace holds AI artifacts the user paid
    // credits for. Refuse, and tell them exactly which workspaces are blocking, so the
    // error is actionable instead of a dead end.
    const using = await this.workspaces.find({
      where: { resumeId: id },
      select: { id: true, name: true },
    });
    if (using.length) throw Problems.resumeInUse(using);

    await this.resumes.softDelete(id);
    // The S3 object stays until the purge job (later sprint) — soft delete means
    // restorable, and an orphaned file is cheaper than an unrecoverable mistake.
  }

  // ── the download link ──
  async getDownloadUrl(id: string, userId: string) {
    const resume = await this.findOwned(id, userId);
    return this.storage.getSignedUrl(
      resume.originalFileKey,
      resume.originalFilename,
    );
  }

  // ── retry a failed extraction ──
  async retry(id: string, userId: string) {
    const resume = await this.findOwned(id, userId);
    if (resume.status !== 'failed')
      throw Problems.resumeNotReady(resume.status);
    await this.resumes.update(id, { status: 'uploaded', parseError: null });
    await this.queue.add(
      'extract-text',
      { resumeId: id },
      { jobId: `extract-${id}-${Date.now()}` }, // new jobId — the old one is spent
    );
    return this.findOwned(id, userId);
  }
}
