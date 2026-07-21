import { ResumeSection } from '../../resumes/entities/resume-section.entity';
import { OptimizableSectionType } from '../entities/ai-suggestion.entity';

/**
 * A shared addressing scheme for "one specific piece of prose inside a resume section",
 * used both to VERIFY a model-proposed suggestion (SuggestionsService) and to APPLY an
 * accepted one (ResumeVersionsService). One implementation, so the two can never drift
 * out of sync about what `(sectionType, itemIndex, bulletIndex)` actually points at.
 *
 * Addressing rules, per the REAL section shapes (src/ai/schemas/resume-sections.schema.ts
 * — not the generic {description, bullets} shape a naive design might assume):
 *  - summary:     itemIndex/bulletIndex both null → content.text
 *  - skills:      content is string[]; itemIndex → content[itemIndex], bulletIndex null
 *  - experience:  content is ExperienceItem[]; itemIndex → the item, bulletIndex →
 *                 item.highlights[bulletIndex] (experience has no single "whole item"
 *                 prose field, so bulletIndex is required here)
 *  - projects:    content is ProjectItem[]; itemIndex → the item, bulletIndex must be
 *                 null → item.description
 */

interface ExperienceItemLike {
  company: string | null;
  title: string | null;
  highlights: string[];
}
interface ProjectItemLike {
  description: string | null;
}
interface SummaryLike {
  text: string | null;
}

export function findSection(
  sections: ResumeSection[],
  sectionType: OptimizableSectionType,
): ResumeSection | undefined {
  return sections.find((s) => s.sectionType === sectionType);
}

export function readSuggestionTarget(
  sectionType: OptimizableSectionType,
  content: unknown,
  itemIndex: number | null,
  bulletIndex: number | null,
): string | null {
  switch (sectionType) {
    case 'summary': {
      const text = (content as SummaryLike | null)?.text;
      return typeof text === 'string' ? text : null;
    }
    case 'skills': {
      if (itemIndex === null || !Array.isArray(content)) return null;
      const value = (content as string[])[itemIndex];
      return typeof value === 'string' ? value : null;
    }
    case 'experience': {
      if (itemIndex === null || bulletIndex === null || !Array.isArray(content))
        return null;
      const item = (content as ExperienceItemLike[])[itemIndex];
      const value = item?.highlights?.[bulletIndex];
      return typeof value === 'string' ? value : null;
    }
    case 'projects': {
      if (itemIndex === null || bulletIndex !== null || !Array.isArray(content))
        return null;
      const item = (content as ProjectItemLike[])[itemIndex];
      return item?.description ?? null;
    }
    default:
      return null;
  }
}

/** Mutates `content` in place. Returns false if the address doesn't resolve. */
export function writeSuggestionTarget(
  sectionType: OptimizableSectionType,
  content: unknown,
  itemIndex: number | null,
  bulletIndex: number | null,
  text: string,
): boolean {
  switch (sectionType) {
    case 'summary': {
      if (!content || typeof content !== 'object') return false;
      (content as SummaryLike).text = text;
      return true;
    }
    case 'skills': {
      if (itemIndex === null || !Array.isArray(content)) return false;
      if (itemIndex >= content.length) return false;
      (content as string[])[itemIndex] = text;
      return true;
    }
    case 'experience': {
      if (itemIndex === null || bulletIndex === null || !Array.isArray(content))
        return false;
      const item = (content as ExperienceItemLike[])[itemIndex];
      if (!item?.highlights || bulletIndex >= item.highlights.length)
        return false;
      item.highlights[bulletIndex] = text;
      return true;
    }
    case 'projects': {
      if (itemIndex === null || bulletIndex !== null || !Array.isArray(content))
        return false;
      const item = (content as ProjectItemLike[])[itemIndex];
      if (!item) return false;
      item.description = text;
      return true;
    }
    default:
      return false;
  }
}

const OPTIMIZABLE: OptimizableSectionType[] = [
  'summary',
  'experience',
  'projects',
  'skills',
];

/**
 * Renders the four optimisable sections with explicit `[sectionType:item:bullet]`
 * address markers so the model can reference them precisely, and so that whatever it
 * returns can be located again with readSuggestionTarget above.
 */
export function renderSectionsWithIndices(sections: ResumeSection[]): string {
  const blocks: string[] = [];

  for (const type of OPTIMIZABLE) {
    const section = findSection(sections, type);
    if (!section) continue;

    if (type === 'summary') {
      const text = (section.content as SummaryLike | null)?.text;
      if (text) blocks.push(`SUMMARY:\n[summary] "${text}"`);
      continue;
    }

    if (type === 'skills') {
      const items = (section.content as string[]) ?? [];
      if (!items.length) continue;
      const lines = items.map((s, i) => `  [skills:${i}] "${s}"`);
      blocks.push(`SKILLS:\n${lines.join('\n')}`);
      continue;
    }

    if (type === 'experience') {
      const items = (section.content as ExperienceItemLike[]) ?? [];
      if (!items.length) continue;
      const lines = items.flatMap((item, i) => {
        const header = `  [experience:${i}] ${[item.title, item.company].filter(Boolean).join(' at ') || 'Untitled role'}`;
        const highlightLines = (item.highlights ?? []).map(
          (h, j) => `    [experience:${i}:${j}] "${h}"`,
        );
        return [header, ...highlightLines];
      });
      blocks.push(`EXPERIENCE:\n${lines.join('\n')}`);
      continue;
    }

    if (type === 'projects') {
      const items = (section.content as ProjectItemLike[]) ?? [];
      if (!items.length) continue;
      const lines = items.map(
        (p, i) => `  [projects:${i}] "${p.description ?? ''}"`,
      );
      blocks.push(`PROJECTS:\n${lines.join('\n')}`);
      continue;
    }
  }

  return blocks.join('\n\n');
}
