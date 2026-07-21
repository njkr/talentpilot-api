import { Injectable } from '@nestjs/common';
import { AiService } from '../../ai/ai.service';
import { KeywordEquivalence } from '../../ai/schemas/keyword-equivalence.schema';
import { JobDescription } from '../../job-descriptions/entities/job-description.entity';
import { ResumeSection } from '../../resumes/entities/resume-section.entity';
import { SKILL_ALIASES, canonicalise } from '../data/skill-aliases';

interface ExperienceItem {
  company: string | null;
  title: string | null;
  highlights: string[];
}
interface ProjectItem {
  name: string | null;
  technologies: string[];
}

export interface KeywordMatch {
  keyword: string;
  canonical: string;
  category: string;
  importance: 'required' | 'preferred' | 'nice_to_have';
  status: 'matched' | 'partial' | 'missing';
  foundIn: string[];
  evidence?: string | null;
  source: 'exact' | 'ai';
  suggestion?: string | null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

@Injectable()
export class KeywordMatcherService {
  constructor(private readonly ai: AiService) {}

  async match(
    jd: JobDescription,
    sections: ResumeSection[],
    resumeText: string,
    userId: string,
  ): Promise<KeywordMatch[]> {
    if (!jd.parsedData) {
      throw new Error(`JobDescription ${jd.id} has not been analyzed yet`);
    }
    const skills = jd.parsedData.skills;

    // ── PASS 1: deterministic. Free, instant, reproducible. ──
    const resumeTerms = this.extractResumeTerms(sections);
    const results: KeywordMatch[] = [];
    const uncertain: typeof skills = [];

    for (const skill of skills) {
      const canon = canonicalise(skill.name);
      const foundIn = resumeTerms.get(canon);
      if (foundIn) {
        results.push({
          keyword: skill.name,
          canonical: canon,
          category: skill.category,
          importance: skill.importance,
          status: 'matched',
          foundIn,
          source: 'exact',
        });
      } else {
        uncertain.push(skill);
      }
    }

    // ── PASS 2: AI, only for what pass 1 couldn't settle. ──
    if (uncertain.length) {
      const { data: out } = await this.ai.complete<KeywordEquivalence>({
        feature: 'keyword_equivalence',
        promptKey: 'keyword_equivalence',
        variables: {
          keywords: uncertain
            .map((s) => `- ${s.name} (${s.category})`)
            .join('\n'),
          resume_text: resumeText,
        },
        truncateVariable: 'resume_text',
        userId,
      });

      const byName = new Map(
        out.matches.map((m) => [m.keyword.toLowerCase(), m]),
      );
      for (const skill of uncertain) {
        const m = byName.get(skill.name.toLowerCase());
        results.push({
          keyword: skill.name,
          canonical: canonicalise(skill.name),
          category: skill.category,
          importance: skill.importance,
          status: m?.status ?? 'missing',
          evidence: m?.evidence ?? null,
          foundIn: [],
          source: 'ai',
          suggestion:
            (m?.status ?? 'missing') === 'missing'
              ? this.suggestion(skill)
              : null,
        });
      }
    }
    return results;
  }

  /**
   * Builds the set of terms the resume demonstrably contains. Field names here match the
   * ACTUAL Sprint 3 section schemas: skills is a flat string[] (not grouped by category),
   * projects has a `technologies` array (no bullets), experience has `highlights`.
   */
  private extractResumeTerms(sections: ResumeSection[]): Map<string, string[]> {
    const found = new Map<string, string[]>();
    const add = (term: string, where: string) => {
      const c = canonicalise(term);
      if (!c || c.length < 2) return;
      found.set(c, [...(found.get(c) ?? []), where]);
    };

    for (const s of sections) {
      if (s.sectionType === 'skills') {
        for (const item of s.content as string[]) add(item, 'skills');
      }
      if (s.sectionType === 'projects') {
        for (const p of s.content as ProjectItem[]) {
          for (const t of p.technologies)
            add(t, `project: ${p.name ?? 'untitled'}`);
        }
      }
      if (s.sectionType === 'experience') {
        for (const e of s.content as ExperienceItem[]) {
          const text = e.highlights.join(' ').toLowerCase();
          // Word-boundary check against known canonical terms. Substring matching would
          // find "java" inside "javascript" and "go" inside "algorithm".
          for (const canon of Object.keys(SKILL_ALIASES)) {
            const re = new RegExp(`\\b${escapeRegex(canon)}\\b`, 'i');
            if (re.test(text)) {
              add(
                canon,
                [e.title, e.company].filter(Boolean).join(' at ') ||
                  'experience',
              );
            }
          }
        }
      }
    }
    return found;
  }

  private suggestion(skill: { name: string; importance: string }): string {
    return skill.importance === 'required'
      ? `"${skill.name}" is required for this role and isn't evident in your resume. Add it to your skills section and reference it in a bullet if you have real experience.`
      : `Consider mentioning "${skill.name}" if you have relevant experience.`;
  }
}
