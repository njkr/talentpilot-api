import { Test, TestingModule } from '@nestjs/testing';
import { FileValidatorService } from './file-validator.service';
import { Env } from 'src/config/config.module';
import { AppException } from 'src/common/exceptions/app.exception';

const asFile = (buffer: Buffer, overrides: Partial<Express.Multer.File> = {}) =>
  ({
    buffer,
    size: buffer.length,
    originalname: 'resume.pdf',
    mimetype: 'application/pdf',
    ...overrides,
  }) as Express.Multer.File;

describe('FileValidatorService', () => {
  let service: FileValidatorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileValidatorService,
        {
          provide: Env,
          useValue: {
            get: (k: string) => (k === 'MAX_FILE_SIZE_MB' ? 10 : undefined),
          },
        },
      ],
    }).compile();

    service = module.get(FileValidatorService);
  });

  it('accepts a real PDF (starts with %PDF-)', async () => {
    const buf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200)]);
    await expect(service.validate(asFile(buf))).resolves.toEqual({
      ext: 'pdf',
      mime: 'application/pdf',
    });
  });

  it('rejects an executable renamed to .pdf (wrong magic bytes)', async () => {
    // PE header ("MZ"), not %PDF- — mimetype/extension both lie and say PDF.
    const buf = Buffer.concat([
      Buffer.from([0x4d, 0x5a, 0x90, 0x00]),
      Buffer.alloc(200),
    ]);
    await expect(service.validate(asFile(buf))).rejects.toBeInstanceOf(
      AppException,
    );
  });

  it('accepts a real DOCX (zip magic + word/document.xml marker)', async () => {
    const buf = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.alloc(50),
      Buffer.from('word/document.xml'),
      Buffer.alloc(50),
    ]);
    await expect(
      service.validate(asFile(buf, { originalname: 'resume.docx' })),
    ).resolves.toEqual({
      ext: 'docx',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  });

  it('rejects an xlsx renamed to .docx — zip magic alone is not enough', async () => {
    // Same zip magic bytes, but no word/document.xml anywhere in the archive.
    const buf = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.alloc(50),
      Buffer.from('xl/workbook.xml'),
      Buffer.alloc(50),
    ]);
    await expect(
      service.validate(asFile(buf, { originalname: 'resume.docx' })),
    ).rejects.toBeInstanceOf(AppException);
  });

  it('rejects a file over MAX_FILE_SIZE_MB', async () => {
    const buf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200)]);
    const oversized = asFile(buf, { size: 11 * 1024 * 1024 });
    await expect(service.validate(oversized)).rejects.toBeInstanceOf(
      AppException,
    );
  });

  it('rejects an empty/truncated file', async () => {
    const buf = Buffer.from('%PDF-');
    await expect(
      service.validate(asFile(buf, { size: buf.length })),
    ).rejects.toBeInstanceOf(AppException);
  });

  it('countPdfPages counts /Type /Page occurrences', () => {
    const buf = Buffer.from(
      '/Type /Page /Type /Page /Type /Page /Type /Pages (not a page)',
    );
    expect(service.countPdfPages(buf)).toBe(3);
  });
});
