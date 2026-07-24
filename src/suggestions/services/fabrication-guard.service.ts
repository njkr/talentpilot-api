import { Injectable, Logger } from '@nestjs/common';
import { ResumeSection } from '../../resumes/entities/resume-section.entity';

export interface FabricationCheck {
  safe: boolean;
  violations: string[];
}

interface ExperienceItemLike {
  company: string | null;
}
interface EducationItemLike {
  institution: string | null;
}
interface CertificationItemLike {
  issuer: string | null;
}
interface ProjectItemLike {
  name: string | null;
}

/**
 * ⚠️ THE MOST IMPORTANT ~100 LINES IN THIS FEATURE.
 *
 * Prompt rules reduce fabrication. They do not eliminate it — a model under pressure to
 * "add the missing keyword" will occasionally invent the experience that justifies it.
 * The consequence is not a bad UX: it's a candidate confidently discussing a project
 * they never did, in an interview, because our tool told them it was on their resume.
 *
 * So we verify in code. Every entity in newText that could be a claim of fact must
 * already exist somewhere in the ORIGINAL resume. If it doesn't, we drop the suggestion
 * and log it — the user never sees it.
 */
@Injectable()
export class FabricationGuardService {
  private readonly logger = new Logger(FabricationGuardService.name);

  check(
    newText: string,
    sourceText: string,
    knownOrgs: string[],
    // Extra names that are legitimately allowed to appear even though they're not IN
    // the resume — e.g. a cover letter naming the company it's addressed to. Kept
    // separate from knownOrgs (which comes from the resume itself) so callers that
    // don't have one don't need to fake an empty array in a specific shape.
    allowedOrgs: string[] = [],
  ): FabricationCheck {
    const violations: string[] = [];
    const source = this.normalise(sourceText);

    // ── 1. NUMBERS ──
    // The highest-risk fabrication: "improved performance" → "improved performance by
    // 40%". That 40% is a checkable claim the candidate cannot defend. Every number in
    // the output must exist in the source.
    for (const num of this.extractNumbers(newText)) {
      if (!this.sourceHasNumber(source, num)) {
        violations.push(`invented number: "${num}"`);
      }
    }

    // ── 2. YEARS / DATES ──
    for (const year of newText.match(/\b(19|20)\d{2}\b/g) ?? []) {
      if (!source.includes(year)) violations.push(`invented year: "${year}"`);
    }

    // ── 3. ORGANISATIONS ──
    // Capitalised multi-word sequences that look like company/institution names. We
    // check against the parsed org list rather than doing NER — we already know every
    // employer and school from the structured parse, which is more reliable.
    //
    // Containment, not equality: extractCapitalisedPhrases() pulls out the whole
    // contiguous capitalised run, so a salutation like "Dear Stripe Hiring Team" is ONE
    // candidate phrase, not "Stripe" on its own. Requiring the full phrase to equal a
    // known/allowed org name meant naming the real company in a greeting — exactly what
    // callers are told to do — always failed this check. Checking whether a known org
    // appears WITHIN the candidate fixes that without weakening the guard: a genuinely
    // fabricated org (e.g. "Goldman Sachs") still won't contain any real known org name.
    for (const candidate of this.extractCapitalisedPhrases(newText)) {
      const known =
        knownOrgs.some((o) => this.orgAppearsIn(candidate, o)) ||
        allowedOrgs.some((o) => this.orgAppearsIn(candidate, o)) ||
        source.includes(this.normalise(candidate));
      if (!known) violations.push(`unrecognised organisation: "${candidate}"`);
    }

    // ── 4. CREDENTIAL LANGUAGE ──
    // Phrases that assert a qualification. Adding "certified" or "MSc" is a
    // categorically different lie from rephrasing a bullet.
    const credentials =
      /\b(certified|licen[cs]ed|accredited|PhD|MSc|MBA|BSc|degree in)\b/gi;
    for (const m of newText.match(credentials) ?? []) {
      if (!new RegExp(`\\b${this.escapeRegex(m)}\\b`, 'i').test(sourceText)) {
        violations.push(`invented credential: "${m}"`);
      }
    }

    if (violations.length) {
      this.logger.warn(
        `suggestion dropped: ${violations.join('; ')} — newText="${newText.slice(0, 200)}"`,
      );
    }
    return { safe: violations.length === 0, violations };
  }

  /**
   * Extract numeric claims. Deliberately narrow: we want percentages, currency, counts,
   * and multipliers — not every stray digit. Matching too broadly produces false
   * positives on things like "Python 3" and users lose good suggestions.
   */
  /**
   * Every org name genuinely on the candidate's resume — employers, schools,
   * certification issuers, project names — the vocabulary `check()` treats as
   * "known" rather than "unrecognised organisation". Shared between every caller
   * (the resume optimiser, the cover letter generator, ...) so there's exactly one
   * place that knows how to read an org name out of each section type.
   */
  collectKnownOrgs(sections: ResumeSection[]): string[] {
    const orgs: string[] = [];
    for (const s of sections) {
      if (s.sectionType === 'experience') {
        orgs.push(
          ...(s.content as ExperienceItemLike[]).map((e) => e.company ?? ''),
        );
      }
      if (s.sectionType === 'education') {
        orgs.push(
          ...(s.content as EducationItemLike[]).map((e) => e.institution ?? ''),
        );
      }
      if (s.sectionType === 'certifications') {
        orgs.push(
          ...(s.content as CertificationItemLike[]).map((c) => c.issuer ?? ''),
        );
      }
      if (s.sectionType === 'projects') {
        orgs.push(...(s.content as ProjectItemLike[]).map((p) => p.name ?? ''));
      }
    }
    return orgs.filter(Boolean);
  }

  private extractNumbers(text: string): string[] {
    const out = new Set<string>();
    for (const m of text.match(/\b\d+(?:[.,]\d+)?\s*%/g) ?? [])
      out.add(m.replace(/\s/g, ''));
    for (const m of text.match(/[$€£]\s*\d+(?:[.,]\d+)?\s*[KMB]?/gi) ?? [])
      out.add(m.replace(/\s/g, ''));
    for (const m of text.match(/\b\d+(?:[.,]\d+)?\s*[KMB]\b/gi) ?? [])
      out.add(m.replace(/\s/g, ''));
    for (const m of text.match(/\b\d+x\b/gi) ?? []) out.add(m);
    // Bare integers >= 2 digits ("led 15 engineers"). Single digits are too noisy.
    for (const m of text.match(/\b\d{2,}\b/g) ?? []) out.add(m);
    return [...out];
  }

  /**
   * A number is present if it appears in the source in ANY reasonable form. "40%" in
   * output is fine if the source says "40 percent" or "40%". We do NOT allow "increased
   * by 40%" when the source only says "increased by 4%".
   */
  private sourceHasNumber(source: string, num: string): boolean {
    const digits = num.replace(/[^\d.]/g, '');
    if (!digits) return true;
    // Word boundary so "4" doesn't match inside "40" or "2024".
    return new RegExp(`\\b${digits.replace('.', '\\.')}\\b`).test(source);
  }

  private extractCapitalisedPhrases(text: string): string[] {
    // Two or more capitalised words in sequence — "Acme Corporation", "Stanford
    // University". Single capitalised words are excluded: too many false positives
    // from sentence starts and technology names.
    //
    // The joiner is [ \t]+, not \s+: \s also matches newlines, which let a paragraph
    // break glue two UNRELATED capitalised words into one bogus candidate — e.g. a
    // letter ending one paragraph with "...built with NestJS." and starting the next
    // with "My experience..." produced the single nonsense candidate "NestJS.\n\nMy".
    // Two sentences on the same line can still merge (rarer, an accepted limitation),
    // but a paragraph break — the far more common case — no longer can.
    const matches =
      text.match(/\b[A-Z][a-zA-Z0-9&.'-]+(?:[ \t]+[A-Z][a-zA-Z0-9&.'-]+)+/g) ??
      [];
    const STOPWORDS =
      /^(The|A|An|And|For|With|At|In|On|To|Of|By|Led|Built|Designed|Managed)\b/;
    return matches.filter((m) => !STOPWORDS.test(m));
  }

  /**
   * Whether known/allowed org `o` is "the same organisation" as `candidate`, tolerating
   * paraphrase — see the call site above. Word-overlap, not exact/substring match: a
   * cover letter is free to write "Senior Fullstack Developer" for a JD position of
   * "Sr. Fullstack Developer", and "Dear Stripe Hiring Team" for an allowed org of
   * "Stripe" — neither is fabrication, both are the model using words we gave it. A
   * majority of the KNOWN org's own significant words appearing in the candidate is
   * enough; a wholly different name (0% overlap) still gets flagged.
   */
  private orgAppearsIn(candidate: string, o: string): boolean {
    const orgWords = this.significantWords(o);
    if (!orgWords.length) return false; // an empty/trivial org must never match everything
    const candidateWords = new Set(this.significantWords(candidate));
    const overlap = orgWords.filter((w) => candidateWords.has(w)).length;
    return overlap / orgWords.length >= 0.5;
  }

  private significantWords(s: string): string[] {
    return s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2); // drops "sr", "of", "a", ... — too generic to signal a match either way
  }

  private normalise(s: string): string {
    return s.toLowerCase().replace(/\s+/g, ' ');
  }

  private escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
