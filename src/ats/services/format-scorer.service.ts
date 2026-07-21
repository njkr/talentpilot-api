import { Injectable } from '@nestjs/common';
import { Resume } from '../../resumes/entities/resume.entity';
import { ResumeSection } from '../../resumes/entities/resume-section.entity';

interface PersonalInfo {
  email: string | null;
  phone: string | null;
}
interface ExperienceItem {
  highlights: string[];
}

export interface FormatScoreResult {
  score: number;
  issues: string[];
  quantifiedRatio: number;
}

const QUANTIFIED_PATTERN = /\d+\s*%|\$\s*\d|\d{2,}|\b\d+x\b/i;

/**
 * 100% deterministic — no AI. Format is a checklist, and a checklist gives an identical
 * score every run for the same input. Asking a model "rate this resume's formatting"
 * returns 72, then 78, then 69 for the same resume, and users notice.
 */
@Injectable()
export class FormatScorerService {
  score(resume: Resume, sections: ResumeSection[]): FormatScoreResult {
    const issues: string[] = [];
    let score = 100;
    const types = new Set(sections.map((s) => s.sectionType));

    // Standard sections an ATS parser looks for.
    const checks: Array<[type: string, penalty: number, msg: string]> = [
      ['experience', 25, 'No work experience section found'],
      [
        'skills',
        15,
        'No dedicated skills section — ATS keyword matching relies on it',
      ],
      ['education', 10, 'No education section found'],
    ];
    for (const [type, penalty, msg] of checks) {
      if (!types.has(type as ResumeSection['sectionType'])) {
        score -= penalty;
        issues.push(msg);
      }
    }

    // Length. 1-2 pages is the norm; a 6-page resume is filtered by humans, not ATS.
    if (resume.pageCount) {
      if (resume.pageCount > 3) {
        score -= 15;
        issues.push(`${resume.pageCount} pages — aim for 1-2`);
      } else if (resume.pageCount > 2) {
        score -= 5;
        issues.push('Over 2 pages');
      }
    }

    // Word count: under 300 words is thin, over 1200 is a wall of text.
    if (resume.wordCount) {
      if (resume.wordCount < 300) {
        score -= 10;
        issues.push('Very short — add detail to your experience');
      }
      if (resume.wordCount > 1200) {
        score -= 5;
        issues.push('Very long — tighten your bullets');
      }
    }

    // Contact info: an ATS that can't find an email discards the application outright.
    const info = sections.find((s) => s.sectionType === 'personal_info')
      ?.content as PersonalInfo | undefined;
    if (!info?.email) {
      score -= 20;
      issues.push('No email address detected');
    }
    if (!info?.phone) {
      score -= 5;
      issues.push('No phone number detected');
    }

    // Quantified achievements — the single strongest signal of a good bullet.
    const exp = (sections.find((s) => s.sectionType === 'experience')
      ?.content ?? []) as ExperienceItem[];
    const bullets = exp.flatMap((e) => e.highlights ?? []);
    const quantified = bullets.filter((b) => QUANTIFIED_PATTERN.test(b)).length;
    const ratio = bullets.length ? quantified / bullets.length : 0;
    if (bullets.length >= 3 && ratio < 0.2) {
      score -= 10;
      issues.push(
        'Few quantified achievements — add numbers (%, $, scale) to your bullets',
      );
    }

    return {
      score: Math.max(0, Math.min(100, score)),
      issues,
      quantifiedRatio: ratio,
    };
  }
}
