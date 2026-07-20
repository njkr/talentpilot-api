import { Injectable } from '@nestjs/common';
import { Env } from 'src/config/config.module';
import { Problems } from 'src/common/problems';

const PDF_MAGIC = Buffer.from('%PDF-');
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // "PK\x03\x04"

@Injectable()
export class FileValidatorService {
  constructor(private readonly env: Env) {}

  /**
   * NEVER trust file.mimetype or the extension. Both come from the client and both are
   * trivially forged: rename malware.exe → resume.pdf and Multer reports application/pdf.
   * The only trustworthy signal is the byte content itself.
   */
  async validate(
    file: Express.Multer.File,
  ): Promise<{ ext: 'pdf' | 'docx'; mime: string }> {
    const maxBytes = this.env.get('MAX_FILE_SIZE_MB') * 1024 * 1024;
    if (file.size > maxBytes)
      throw Problems.fileTooLarge(this.env.get('MAX_FILE_SIZE_MB'));
    if (file.size < 100) throw Problems.fileCorrupt(); // empty/truncated

    const buf = file.buffer;

    // --- PDF: starts with %PDF- ---
    if (buf.subarray(0, 5).equals(PDF_MAGIC)) {
      return { ext: 'pdf', mime: 'application/pdf' };
    }

    // --- DOCX: it's a ZIP. But so is .jar, .apk, .xlsx, and a zip bomb. ---
    if (buf.subarray(0, 4).equals(ZIP_MAGIC)) {
      // Confirm it's specifically a Word document by looking for the OOXML marker.
      // A real .docx always contains 'word/document.xml'. This one check rejects
      // xlsx/pptx/jar/apk renamed to .docx.
      if (!buf.includes(Buffer.from('word/document.xml'))) {
        throw Problems.fileTypeUnsupported('zip-but-not-docx');
      }
      return {
        ext: 'docx',
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      };
    }

    throw Problems.fileTypeUnsupported(file.mimetype);
  }

  /**
   * Page count without a full parse: count '/Type /Page' occurrences in the PDF.
   * Cheap, and lets us reject a 400-page document before spending CPU extracting it.
   * Approximate by design — we only need "is this absurdly long".
   */
  countPdfPages(buf: Buffer): number {
    const matches = buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g);
    return matches?.length ?? 1;
  }
}
