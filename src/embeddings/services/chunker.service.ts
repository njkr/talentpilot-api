import { Injectable } from '@nestjs/common';
import { TokenCounterService } from '../../ai/services/token-counter.service';
import { DEFAULT_EMBEDDING_MODEL } from '../../ai/model-catalog';
import { ResumeSection } from '../../resumes/entities/resume-section.entity';
import { JobDescription } from '../../job-descriptions/entities/job-description.entity';

export interface Chunk {
  index: number;
  content: string;
  tokenCount: number;
  metadata: { sectionType?: string; label?: string };
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

const TARGET_TOKENS = 400;
const MAX_TOKENS = 600;

@Injectable()
export class ChunkerService {
  constructor(private readonly tokens: TokenCounterService) {}

  /**
   * SECTION-AWARE chunking, not fixed-window.
   *
   * A naive 500-token sliding window cuts mid-job — "Senior Engineer at Acme, 2020-2023"
   * lands in one chunk and its achievements in the next. Then a JD requirement about
   * leadership matches the orphaned bullets with no idea what role they belonged to.
   *
   * Chunking by resume section keeps each unit semantically whole, and lets us tell the
   * user WHERE a match was found ("your Acme experience").
   */
  chunkResume(sections: ResumeSection[]): Chunk[] {
    const chunks: Chunk[] = [];
    let i = 0;

    for (const section of [...sections].sort(
      (a, b) => a.orderIndex - b.orderIndex,
    )) {
      for (const piece of this.renderSection(section)) {
        if (!piece.text.trim()) continue;
        const count = this.count(piece.text);

        if (count <= MAX_TOKENS) {
          chunks.push({
            index: i++,
            content: piece.text,
            tokenCount: count,
            metadata: { sectionType: section.sectionType, label: piece.label },
          });
        } else {
          // Only split when a single item is genuinely huge (a 12-bullet role).
          // Split on line boundaries, never mid-sentence.
          for (const part of this.splitLarge(piece.text)) {
            chunks.push({
              index: i++,
              content: part,
              tokenCount: this.count(part),
              metadata: {
                sectionType: section.sectionType,
                label: piece.label,
              },
            });
          }
        }
      }
    }
    return chunks;
  }

  /**
   * Each section becomes one or more human-readable text pieces. Rendered to prose, not
   * JSON: embedding models are trained on natural language, and `{"company":"Acme"}`
   * embeds worse than "Senior Engineer at Acme". This is a real quality difference.
   *
   * Field names here match the ACTUAL Sprint 3 section schemas (src/ai/schemas/resume-
   * sections.schema.ts) — highlights (not bullets), isCurrent (not current), a flat
   * skills string[] (not grouped by category), and projects has no bullets field.
   */
  private renderSection(s: ResumeSection): { text: string; label?: string }[] {
    switch (s.sectionType) {
      case 'experience':
        return (s.content as ExperienceItem[]).map((e) => ({
          label: [e.title, e.company].filter(Boolean).join(' at ') || undefined,
          text:
            `${e.title ?? 'Unknown role'} at ${e.company ?? 'Unknown company'}` +
            (e.location ? ` (${e.location})` : '') +
            `\n${e.startDate ?? ''} – ${e.isCurrent ? 'present' : (e.endDate ?? '')}\n` +
            e.highlights.map((h) => `• ${h}`).join('\n'),
        }));

      case 'projects':
        return (s.content as ProjectItem[]).map((p) => ({
          label: p.name ?? undefined,
          text:
            `Project: ${p.name ?? 'Untitled'}\n${p.description ?? ''}\n` +
            (p.technologies.length
              ? `Technologies: ${p.technologies.join(', ')}`
              : ''),
        }));

      case 'skills': {
        const items = s.content as string[];
        return items.length
          ? [{ label: 'Skills', text: `Skills: ${items.join(', ')}` }]
          : [];
      }

      case 'education':
        return [
          {
            label: 'Education',
            text:
              'Education:\n' +
              (s.content as EducationItem[])
                .map(
                  (e) =>
                    `${e.degree ?? ''} ${e.field ?? ''} — ${e.institution ?? ''} (${e.endDate ?? ''})`,
                )
                .join('\n'),
          },
        ];

      case 'summary': {
        const text = (s.content as { text: string | null }).text;
        return text
          ? [{ label: 'Summary', text: `Professional summary: ${text}` }]
          : [];
      }

      case 'certifications': {
        const items = s.content as CertificationItem[];
        return items.length
          ? [
              {
                label: 'Certifications',
                text:
                  'Certifications:\n' +
                  items
                    .map(
                      (c) =>
                        `${c.name ?? ''}${c.issuer ? ` — ${c.issuer}` : ''}`,
                    )
                    .join('\n'),
              },
            ]
          : [];
      }

      default:
        // personal_info, languages: not embedded for matching (contact info isn't a
        // requirement to satisfy; language fluency is a keyword-match concern, not a
        // semantic-similarity one).
        return [];
    }
  }

  /**
   * JD chunking: one chunk PER REQUIREMENT, not per paragraph.
   *
   * This is the key asymmetry. We score "does the resume satisfy requirement X" — so each
   * requirement must be its own query vector. Chunking the JD into paragraphs would blur
   * five requirements into one vector and give a meaningless similarity number.
   */
  chunkJd(jd: JobDescription): Chunk[] {
    if (!jd.parsedData) {
      throw new Error(`JobDescription ${jd.id} has not been analyzed yet`);
    }
    return jd.parsedData.requirements.map((r, i) => ({
      index: i,
      content: r.text,
      tokenCount: this.count(r.text),
      metadata: { label: r.importance },
    }));
  }

  private count(text: string): number {
    return this.tokens.countText(DEFAULT_EMBEDDING_MODEL, text);
  }

  private splitLarge(text: string): string[] {
    const lines = text.split('\n');
    const out: string[] = [];
    let buf: string[] = [];
    let n = 0;
    for (const line of lines) {
      const c = this.count(line);
      if (n + c > TARGET_TOKENS && buf.length) {
        out.push(buf.join('\n'));
        buf = [];
        n = 0;
      }
      buf.push(line);
      n += c;
    }
    if (buf.length) out.push(buf.join('\n'));
    return out;
  }
}
