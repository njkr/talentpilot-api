import { ResumeSection } from '../../resumes/entities/resume-section.entity';

interface ExperienceItemLike {
  company: string | null;
  title: string | null;
  highlights: string[];
}
interface ProjectItemLike {
  name: string | null;
  description: string | null;
}
interface EducationItemLike {
  institution: string | null;
  degree: string | null;
}
interface CertificationItemLike {
  name: string | null;
  issuer: string | null;
}
interface LanguageItemLike {
  name: string | null;
  proficiency: string | null;
}

/**
 * Renders a section's jsonb content to flat, readable prose for the version diff view —
 * a diff over `JSON.stringify(content)` would surface brace/quote/comma noise on every
 * line even when only one word actually changed.
 */
export function flattenSection(section: ResumeSection | undefined): string {
  if (!section) return '';
  const content = section.content;

  switch (section.sectionType) {
    case 'summary':
      return (content as { text: string | null })?.text ?? '';

    case 'skills':
      return (content as string[]).join(', ');

    case 'experience':
      return (content as ExperienceItemLike[])
        .map(
          (e) =>
            `${e.title ?? ''} at ${e.company ?? ''}\n` +
            (e.highlights ?? []).map((h) => `- ${h}`).join('\n'),
        )
        .join('\n\n');

    case 'projects':
      return (content as ProjectItemLike[])
        .map((p) => `${p.name ?? ''}: ${p.description ?? ''}`)
        .join('\n\n');

    case 'education':
      return (content as EducationItemLike[])
        .map((e) => `${e.degree ?? ''} — ${e.institution ?? ''}`)
        .join('\n');

    case 'certifications':
      return (content as CertificationItemLike[])
        .map((c) => `${c.name ?? ''} — ${c.issuer ?? ''}`)
        .join('\n');

    case 'languages':
      return (content as LanguageItemLike[])
        .map((l) => `${l.name ?? ''} (${l.proficiency ?? ''})`)
        .join('\n');

    case 'personal_info':
    default:
      return '';
  }
}
