import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import {
  DocType,
  GeneratedDocument,
} from './entities/generated-document.entity';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { CoverLetter } from '../cover-letter/entities/cover-letter.entity';
import { StorageService } from '../storage/storage.service';
import { Problems } from '../common/problems';

const EXT: Record<DocType, string> = {
  resume_pdf: 'pdf',
  resume_docx: 'docx',
  cover_letter_pdf: 'pdf',
  cover_letter_docx: 'docx',
  full_report_pdf: 'pdf',
};

const LABEL: Record<DocType, string> = {
  resume_pdf: 'Resume',
  resume_docx: 'Resume',
  cover_letter_pdf: 'Cover Letter',
  cover_letter_docx: 'Cover Letter',
  full_report_pdf: 'Full Report',
};

@Injectable()
export class DocumentsService {
  constructor(
    @InjectRepository(GeneratedDocument)
    private readonly docs: Repository<GeneratedDocument>,
    @InjectRepository(Workspace)
    private readonly workspaces: Repository<Workspace>,
    @InjectRepository(CoverLetter)
    private readonly letters: Repository<CoverLetter>,
    @InjectQueue('documents') private readonly queue: Queue,
    private readonly storage: StorageService,
  ) {}

  /**
   * Every call creates a NEW row rather than reusing an existing 'ready' one for the
   * same type — cheap (rendering, no AI cost) and keeps the model simple: the download
   * endpoint always resolves against the specific document id the client requested,
   * never a "latest of this type" lookup that could race with a concurrent regenerate.
   */
  async request(
    workspaceId: string,
    userId: string,
    type: DocType,
  ): Promise<GeneratedDocument> {
    const ws = await this.workspaces.findOne({
      where: { id: workspaceId, userId },
      relations: { resume: true },
    });
    if (!ws) throw new NotFoundException();

    const letter =
      type !== 'resume_pdf' && type !== 'resume_docx'
        ? await this.letters.findOne({
            where: { workspaceId, isCurrent: true },
          })
        : null;

    const doc = await this.docs.save(
      this.docs.create({
        workspaceId,
        userId,
        type,
        filename: `${LABEL[type]} - ${ws.name}.${EXT[type]}`,
        resumeVersion:
          type === 'cover_letter_pdf' || type === 'cover_letter_docx'
            ? null
            : ws.resume.currentVersion,
        coverLetterVersion: letter?.version ?? null,
        status: 'queued',
      }),
    );

    await this.queue.add('generate', { documentId: doc.id });
    return doc;
  }

  async list(
    workspaceId: string,
    userId: string,
  ): Promise<GeneratedDocument[]> {
    await this.assertWorkspaceOwned(workspaceId, userId);
    return this.docs.find({
      where: { workspaceId },
      order: { createdAt: 'DESC' },
    });
  }

  async get(
    workspaceId: string,
    userId: string,
    id: string,
  ): Promise<GeneratedDocument> {
    await this.assertWorkspaceOwned(workspaceId, userId);
    const doc = await this.docs.findOne({ where: { id, workspaceId } });
    if (!doc) throw new NotFoundException();
    return doc;
  }

  async downloadUrl(
    workspaceId: string,
    userId: string,
    id: string,
  ): Promise<{ url: string; filename: string }> {
    const doc = await this.get(workspaceId, userId, id);
    if (doc.status !== 'ready' || !doc.fileKey) {
      throw Problems.documentNotReady(doc.status);
    }
    const url = await this.storage.getSignedUrl(doc.fileKey, doc.filename);
    return { url, filename: doc.filename };
  }

  private async assertWorkspaceOwned(
    workspaceId: string,
    userId: string,
  ): Promise<void> {
    const ws = await this.workspaces.findOne({
      where: { id: workspaceId, userId },
    });
    if (!ws) throw new NotFoundException();
  }
}
