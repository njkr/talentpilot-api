import { NotFoundException } from '@nestjs/common';
import { DocumentsService } from './documents.service';

function build() {
  const docs = {
    save: jest.fn((x) => Promise.resolve({ id: 'doc-1', ...x })),
    create: jest.fn((x) => x),
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
  };
  const workspaces = {
    findOne: jest.fn().mockResolvedValue({
      id: 'ws-1',
      userId: 'user-1',
      name: 'Acme — Backend Engineer',
      resume: { currentVersion: 3 },
    }),
  };
  const letters = { findOne: jest.fn().mockResolvedValue(null) };
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  const storage = {
    getSignedUrl: jest.fn().mockResolvedValue('https://signed/x'),
  };

  const service = new DocumentsService(
    docs as any,
    workspaces as any,
    letters as any,
    queue as any,
    storage as any,
  );

  return { service, docs, workspaces, letters, queue, storage };
}

describe('DocumentsService.request', () => {
  it('404s if the workspace does not belong to the user', async () => {
    const { service, workspaces } = build();
    workspaces.findOne.mockResolvedValue(null);
    await expect(
      service.request('ws-1', 'user-1', 'resume_pdf'),
    ).rejects.toThrow(NotFoundException);
  });

  it('snapshots the resume version for a resume doc, and enqueues a generation job', async () => {
    const { service, docs, queue } = build();
    const doc = await service.request('ws-1', 'user-1', 'resume_pdf');

    expect(doc.resumeVersion).toBe(3);
    expect(doc.status).toBe('queued');
    expect(docs.save).toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledWith('generate', { documentId: 'doc-1' });
  });

  it('does not set resumeVersion for a cover-letter-only document type', async () => {
    const { service, letters } = build();
    letters.findOne.mockResolvedValue({ version: 2 });
    const doc = await service.request('ws-1', 'user-1', 'cover_letter_pdf');

    expect(doc.resumeVersion).toBeNull();
    expect(doc.coverLetterVersion).toBe(2);
  });
});

describe('DocumentsService.downloadUrl', () => {
  it('throws DOCUMENT_NOT_READY if the document is still generating', async () => {
    const { service, docs } = build();
    docs.findOne.mockResolvedValue({
      id: 'doc-1',
      workspaceId: 'ws-1',
      status: 'generating',
      fileKey: null,
    });

    await expect(
      service.downloadUrl('ws-1', 'user-1', 'doc-1'),
    ).rejects.toMatchObject({ code: 'DOCUMENT_NOT_READY' });
  });

  it('returns a signed URL for a ready document', async () => {
    const { service, docs, storage } = build();
    docs.findOne.mockResolvedValue({
      id: 'doc-1',
      workspaceId: 'ws-1',
      status: 'ready',
      fileKey: 'users/user-1/workspaces/ws-1/doc-1/Resume.pdf',
      filename: 'Resume.pdf',
    });

    const result = await service.downloadUrl('ws-1', 'user-1', 'doc-1');

    expect(result.url).toBe('https://signed/x');
    expect(storage.getSignedUrl).toHaveBeenCalledWith(
      'users/user-1/workspaces/ws-1/doc-1/Resume.pdf',
      'Resume.pdf',
    );
  });
});
