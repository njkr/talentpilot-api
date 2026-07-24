import { Injectable } from '@nestjs/common';
import {
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  TabStopPosition,
  TabStopType,
  TextRun,
} from 'docx';
import { ResumeSection } from '../../resumes/entities/resume-section.entity';

interface PersonalInfo {
  fullName: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  links: { label: string; url: string }[];
}
interface ExperienceItem {
  company: string | null;
  title: string | null;
  location: string | null;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
  highlights: string[];
}
interface ProjectItem {
  name: string | null;
  description: string | null;
  url: string | null;
  technologies: string[];
}
interface EducationItem {
  institution: string | null;
  degree: string | null;
  field: string | null;
  startDate: string | null;
  endDate: string | null;
}
interface CertificationItem {
  name: string | null;
  issuer: string | null;
  date: string | null;
}

/**
 * ⚠️ ATS-SAFE FORMATTING RULES — this is the product, not a styling preference.
 *
 * We are selling "beat the ATS". Shipping a beautiful resume that ATS parsers mangle
 * would be actively harmful. Every rule below exists because real parsers break on it:
 *
 *   ✗ TABLES — the single biggest killer. Many parsers read tables column-by-column,
 *     so "Company | 2020-2023" becomes "Company 2020-2023 Other Company 2018-2020"
 *     in one jumbled block, or the second column is dropped entirely.
 *   ✗ TEXT BOXES / SHAPES — usually invisible to the parser. Content simply vanishes.
 *   ✗ MULTI-COLUMN LAYOUTS — read order becomes unpredictable.
 *   ✗ HEADERS / FOOTERS for real content — frequently skipped. Never put contact
 *     details there; that's how a candidate becomes unreachable.
 *   ✗ IMAGES, ICONS, CHARTS — carry no text.
 *   ✗ EXOTIC FONTS — substitution can garble glyphs.
 *
 *   ✓ Single column, linear top-to-bottom flow
 *   ✓ Standard heading text (EXPERIENCE, EDUCATION, SKILLS) — parsers look for these
 *   ✓ Standard bullet characters
 *   ✓ Calibri / Arial / Georgia at 10-12pt
 *
 * Field names below match the REAL Sprint 3 section schemas
 * (src/ai/schemas/resume-sections.schema.ts) — `highlights` (not `bullets`),
 * `isCurrent` (not `current`), a flat `skills: string[]` (not grouped by category),
 * and `projects` items have no bullet list, only a single `description`.
 */
@Injectable()
export class ResumeDocxGenerator {
  private readonly FONT = 'Calibri';

  async generate(
    sections: ResumeSection[],
    fallbackName: string,
  ): Promise<Buffer> {
    const children: Paragraph[] = [];
    const byType = new Map(sections.map((s) => [s.sectionType, s.content]));

    // ── Header: name + contact, as ordinary paragraphs (NOT a document header) ──
    const info = (byType.get('personal_info') as PersonalInfo | undefined) ?? {
      fullName: null,
      email: null,
      phone: null,
      location: null,
      links: [],
    };
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: info.fullName ?? fallbackName,
            bold: true,
            size: 32,
            font: this.FONT,
          }),
        ],
        spacing: { after: 60 },
      }),
    );

    // Contact on one line, pipe-separated. Parsers handle this reliably; a 3-column
    // table of the same information does not.
    const contact = [
      info.email,
      info.phone,
      info.location,
      ...info.links.map((l) => l.url),
    ]
      .filter(Boolean)
      .join('  |  ');
    if (contact) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: contact, size: 20, font: this.FONT })],
          spacing: { after: 200 },
        }),
      );
    }

    const heading = (text: string) =>
      new Paragraph({
        children: [
          new TextRun({
            text: text.toUpperCase(),
            bold: true,
            size: 24,
            font: this.FONT,
          }),
        ],
        spacing: { before: 240, after: 100 },
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999' },
        },
      });

    const summary = byType.get('summary') as
      | { text: string | null }
      | undefined;
    if (summary?.text) {
      children.push(heading('Professional Summary'));
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: summary.text, size: 21, font: this.FONT }),
          ],
          spacing: { after: 120 },
        }),
      );
    }

    // ── Skills: one comma-separated line. NOT a table. ──
    const skills = (byType.get('skills') as string[] | undefined) ?? [];
    if (skills.length) {
      children.push(heading('Skills'));
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: skills.join(', '), size: 21, font: this.FONT }),
          ],
          spacing: { after: 120 },
        }),
      );
    }

    // ── Experience ──
    const experience =
      (byType.get('experience') as ExperienceItem[] | undefined) ?? [];
    if (experience.length) {
      children.push(heading('Experience'));
      for (const e of experience) {
        // Title + company on one line; dates on the SAME line via a tab stop, not a
        // table cell. Tab stops survive parsing; table cells do not.
        children.push(
          new Paragraph({
            tabStops: [
              { type: TabStopType.RIGHT, position: TabStopPosition.MAX },
            ],
            children: [
              new TextRun({
                text: [e.title, e.company].filter(Boolean).join(', ') || 'Role',
                bold: true,
                size: 22,
                font: this.FONT,
              }),
              new TextRun({
                text: `\t${this.dateRange(e)}`,
                size: 20,
                font: this.FONT,
              }),
            ],
            spacing: { before: 120, after: 40 },
          }),
        );
        for (const h of e.highlights ?? []) {
          children.push(
            new Paragraph({
              children: [new TextRun({ text: h, size: 21, font: this.FONT })],
              bullet: { level: 0 },
              spacing: { after: 40 },
            }),
          );
        }
      }
    }

    // ── Projects ──
    const projects =
      (byType.get('projects') as ProjectItem[] | undefined) ?? [];
    if (projects.length) {
      children.push(heading('Projects'));
      for (const proj of projects) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: proj.name ?? 'Project',
                bold: true,
                size: 22,
                font: this.FONT,
              }),
            ],
            spacing: { before: 120, after: 40 },
          }),
        );
        if (proj.description) {
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: proj.description,
                  size: 21,
                  font: this.FONT,
                }),
              ],
              spacing: { after: 40 },
            }),
          );
        }
        if (proj.technologies?.length) {
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: `Technologies: ${proj.technologies.join(', ')}`,
                  italics: true,
                  size: 20,
                  font: this.FONT,
                }),
              ],
              spacing: { after: 60 },
            }),
          );
        }
      }
    }

    // ── Education ──
    const education =
      (byType.get('education') as EducationItem[] | undefined) ?? [];
    if (education.length) {
      children.push(heading('Education'));
      for (const ed of education) {
        const line = [ed.degree, ed.field].filter(Boolean).join(' in ');
        children.push(
          new Paragraph({
            tabStops: [
              { type: TabStopType.RIGHT, position: TabStopPosition.MAX },
            ],
            children: [
              new TextRun({
                text: `${line || 'Education'} — ${ed.institution ?? ''}`,
                bold: true,
                size: 22,
                font: this.FONT,
              }),
              new TextRun({
                text: `\t${this.dateRange({ startDate: ed.startDate, endDate: ed.endDate, isCurrent: false })}`,
                size: 20,
                font: this.FONT,
              }),
            ],
            spacing: { before: 120, after: 40 },
          }),
        );
      }
    }

    // ── Certifications ──
    const certs =
      (byType.get('certifications') as CertificationItem[] | undefined) ?? [];
    if (certs.length) {
      children.push(heading('Certifications'));
      for (const c of certs) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `${c.name ?? ''}${c.issuer ? ` — ${c.issuer}` : ''}${c.date ? ` (${c.date})` : ''}`,
                size: 21,
                font: this.FONT,
              }),
            ],
            spacing: { after: 40 },
          }),
        );
      }
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

  private dateRange(e: {
    startDate: string | null;
    endDate: string | null;
    isCurrent: boolean;
  }): string {
    // Dates are free text in the parsed schema ("Jan 2020", "2020", "Summer 2019") —
    // rendered as-is rather than re-parsed, since a malformed source date must not
    // crash document generation.
    const start = e.startDate ?? '';
    const end = e.isCurrent ? 'Present' : (e.endDate ?? '');
    if (!start && !end) return '';
    return `${start} – ${end}`;
  }
}
