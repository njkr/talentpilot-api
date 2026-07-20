import { Injectable } from '@nestjs/common';
import { PDFParse } from 'pdf-parse';
import * as mammoth from 'mammoth';

export interface ExtractResult {
  text: string;
  wordCount: number;
  pageCount?: number;
  language: string | null;
}

const FRANC_TO_ISO639_1: Record<string, string> = {
  eng: 'en',
  spa: 'es',
  fra: 'fr',
  deu: 'de',
  por: 'pt',
  ita: 'it',
  nld: 'nl',
  hin: 'hi',
  arb: 'ar',
  cmn: 'zh',
};

// Built via the RegExp constructor from escaped code points (rather than a character-class
// literal) so no literal control/zero-width bytes ever sit in this source file:
//   U+0000-U+0008, U+000B, U+000C, U+000E-U+001F  (control chars)
//   U+200B-U+200D, U+FEFF                          (zero-width space/joiners, BOM)
const CONTROL_AND_ZERO_WIDTH_CHARS = new RegExp(
  '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u200B-\\u200D\\uFEFF]',
  'g',
);
const NON_BREAKING_SPACE = new RegExp('\\u00A0', 'g'); // U+00A0

@Injectable()
export class TextExtractorService {
  async extract(buf: Buffer, mime: string): Promise<ExtractResult> {
    const raw =
      mime === 'application/pdf'
        ? await this.extractPdf(buf)
        : await this.extractDocx(buf);

    const text = this.normalize(raw.text);
    return {
      text,
      wordCount: text.split(/\s+/).filter(Boolean).length,
      pageCount: raw.pageCount,
      language: text.length > 100 ? await this.detectLanguage(text) : null,
    };
  }

  private async extractPdf(buf: Buffer) {
    // pdf-parse v2's API: a stateful parser you must destroy(), not a bare function call.
    const parser = new PDFParse({ data: buf });
    try {
      const result = await parser.getText();
      return { text: result.text, pageCount: result.pages.length };
    } finally {
      await parser.destroy();
    }
  }

  private async extractDocx(buf: Buffer) {
    // extractRawText, NOT convertToHtml: we want plain text for the AI, and HTML
    // would smuggle markup into the prompt (and cost tokens for nothing).
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return { text: value, pageCount: undefined as number | undefined }; // DOCX has no fixed page count
  }

  /**
   * Normalization matters more than it looks. PDF extraction produces:
   *  - Windows line endings, form feeds, non-breaking spaces, zero-width chars
   *  - ligatures that break keyword matching (a joined "ffi" glyph vs the letters f-f-i)
   *  - runs of many blank lines between sections
   *  - pdf-parse v2's own "-- N of M --" page-separator markers, which are library
   *    furniture, not resume content, and would otherwise land in rawText verbatim
   * All of that either wastes tokens or breaks the keyword matcher in a later sprint.
   */
  private normalize(text: string): string {
    return text
      .normalize('NFKC') // ligatures → plain letters, full-width → ASCII
      .replace(/\r\n?/g, '\n') // CRLF → LF
      .replace(/\n*-- \d+ of \d+ --\n*/g, '\n') // pdf-parse v2 page separators
      .replace(CONTROL_AND_ZERO_WIDTH_CHARS, '')
      .replace(NON_BREAKING_SPACE, ' ')
      .replace(/[ \t]+/g, ' ') // collapse runs of spaces
      .replace(/ *\n */g, '\n') // trim each line
      .replace(/\n{3,}/g, '\n\n') // max one blank line
      .trim();
  }

  // franc-min ships as an ESM-only package (`"type": "module"`) in a CommonJS project,
  // so it can't be `require()`d — dynamic import() is the only way to load it here.
  private async detectLanguage(text: string): Promise<string | null> {
    const { franc } = await import('franc-min');
    const code = franc(text.slice(0, 2000), { minLength: 100 }); // ISO 639-3
    return FRANC_TO_ISO639_1[code] ?? null;
  }
}
