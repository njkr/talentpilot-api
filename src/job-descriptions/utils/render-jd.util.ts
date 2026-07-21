import { JobDescription } from '../entities/job-description.entity';

/**
 * Shared prose rendering of a JD's parsed data for prompt variables. Mirrors
 * AtsService's private renderJd (Sprint 6) — pulled out here because Sprint 7/8 add
 * several more prompts (optimiser, cover letter) that need the identical rendering and
 * shouldn't each carry their own copy.
 */
export function renderJdSummary(jd: JobDescription): string {
  const d = jd.parsedData;
  if (!d) return `Position: ${jd.position}`;
  const lines = [
    `Position: ${d.position}${d.company ? ` at ${d.company}` : ''}`,
    `Seniority: ${d.seniority}`,
    d.experienceRequired ? `Experience required: ${d.experienceRequired}` : '',
    '',
    'Requirements:',
    ...d.requirements.map((r) => `- [${r.importance}] ${r.text}`),
    '',
    'Responsibilities:',
    ...d.responsibilities.map((r) => `- ${r}`),
  ];
  return lines.filter((l) => l !== '').join('\n');
}
