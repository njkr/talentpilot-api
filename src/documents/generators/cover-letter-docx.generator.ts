import { Injectable } from '@nestjs/common';
import { Document, Packer, Paragraph, TextRun } from 'docx';

export interface CoverLetterDocxInput {
  fullName: string | null;
  email: string | null;
  phone: string | null;
  date: string;
  position: string;
  company: string | null;
  paragraphs: string[];
}

/**
 * Same ATS-safety rules as ResumeDocxGenerator (see that file) — single column,
 * ordinary paragraphs, no tables. A cover letter is simpler (no bullets, no dated
 * entries), so it doesn't need tab stops either — just plain paragraph flow.
 */
@Injectable()
export class CoverLetterDocxGenerator {
  private readonly FONT = 'Calibri';

  async generate(input: CoverLetterDocxInput): Promise<Buffer> {
    const children: Paragraph[] = [];

    if (input.fullName) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: input.fullName,
              bold: true,
              size: 24,
              font: this.FONT,
            }),
          ],
          spacing: { after: 40 },
        }),
      );
    }
    const contact = [input.email, input.phone].filter(Boolean).join('  |  ');
    if (contact) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: contact, size: 20, font: this.FONT })],
          spacing: { after: 200 },
        }),
      );
    }

    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: input.date, size: 21, font: this.FONT }),
        ],
        spacing: { after: 200 },
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `Re: ${input.position}${input.company ? ` at ${input.company}` : ''}`,
            bold: true,
            size: 21,
            font: this.FONT,
          }),
        ],
        spacing: { after: 200 },
      }),
    );

    for (const para of input.paragraphs) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: para, size: 21, font: this.FONT })],
          spacing: { after: 160 },
        }),
      );
    }

    const doc = new Document({
      creator: 'TalentPilot',
      sections: [
        {
          properties: {
            page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } },
          },
          children,
        },
      ],
    });
    return Packer.toBuffer(doc);
  }
}
