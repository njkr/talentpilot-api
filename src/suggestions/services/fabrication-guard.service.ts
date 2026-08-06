import { Injectable, Logger } from '@nestjs/common';
import { ResumeSection } from '../../resumes/entities/resume-section.entity';

// Structured companion to `violations` (which stays a plain string[] — many existing
// regression tests assert against it with String.includes()). Lets a caller offer the
// user something helpful instead of a silent drop: `value` is the AI's own invented
// text, always rendered client-side as an illustrative example ("e.g. ...") the user
// must overwrite with a real detail, never as fact.
export interface FabricationViolation {
  type: 'number' | 'year' | 'organisation' | 'credential' | 'keyword';
  value: string;
  missingFact: string;
}

export interface FabricationCheck {
  safe: boolean;
  violations: string[];
  details: FabricationViolation[];
}

export interface NeedsInfoSummary {
  missingFact: string;
  exampleValue: string | null;
  needsDirectEdit: boolean;
}

interface ExperienceItemLike {
  company: string | null;
}
interface EducationItemLike {
  institution: string | null;
}
interface CertificationItemLike {
  name: string | null;
  issuer: string | null;
}
interface ProjectItemLike {
  name: string | null;
}

// Common tech acronyms/jargon that happen to be capitalised — never organisation
// names on their own, so a candidate phrase built ENTIRELY from these (see
// isTechJargon()) is exempt from the organisation check. Deliberately short and
// generic rather than an exhaustive skills list: the goal is only to rule out
// phrases with no name-bearing word at all, not to recognise every technology.
const TECH_ACRONYMS = new Set([
  'api',
  'apis',
  'rest',
  'restful',
  'sql',
  'nosql',
  'html',
  'css',
  'json',
  'xml',
  'http',
  'https',
  'ci',
  'cd',
  'sdk',
  'ui',
  'ux',
  'saas',
  'paas',
  'iaas',
  'orm',
  'etl',
  'ai',
  'ml',
  'jwt',
  'oauth',
  'sso',
  'crud',
  'mvp',
  'poc',
]);

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

  /**
   * Turns a failed check() into what a needs_info row should show — shared by
   * SuggestionsService.generate() (the initial save) and
   * ResumeVersionsService.provideDetail() (the resubmit path) so both behave
   * identically when a keyword violation is present, rather than drifting apart.
   *
   * A 'keyword' violation gets different treatment than every other type: it's
   * checked against resume.rawText, which is frozen at upload and can never contain a
   * skill added later, so no amount of resubmitting text into provide-detail can ever
   * satisfy it. needsDirectEdit tells the caller (and ultimately the frontend) to point
   * the user at editing their resume directly instead of inviting a retry loop.
   */
  summariseForNeedsInfo(check: FabricationCheck): NeedsInfoSummary {
    const keywordViolations = check.details.filter((d) => d.type === 'keyword');
    if (keywordViolations.length) {
      const skills = [...new Set(keywordViolations.map((d) => d.value))].join(
        ', ',
      );
      return {
        missingFact: `${skills} isn't evidenced anywhere in your resume — add it to your Skills section directly if it's genuinely true, then re-run suggestions. Retyping text here can't fix this.`,
        exampleValue: null,
        needsDirectEdit: true,
      };
    }
    return {
      // Deduped: extractNumbers() can flag the same real value more than once (e.g.
      // "45%" and the bare "45" inside it), which would otherwise repeat the
      // identical missing-fact description.
      missingFact: [...new Set(check.details.map((d) => d.missingFact))].join(
        '; ',
      ),
      exampleValue: check.details[0]?.value ?? null,
      needsDirectEdit: false,
    };
  }

  check(
    newText: string,
    sourceText: string,
    knownOrgs: string[],
    // Extra names that are legitimately allowed to appear even though they're not IN
    // the resume — e.g. a cover letter naming the company it's addressed to. Kept
    // separate from knownOrgs (which comes from the resume itself) so callers that
    // don't have one don't need to fake an empty array in a specific shape.
    allowedOrgs: string[] = [],
    // Certification NAMES the candidate genuinely holds (collectKnownCertifications()).
    // A resume commonly lists a cert by its short name ("AWS Cloud Practitioner")
    // without ever writing "certified" or naming the issuer — but the credential's
    // real/official name often DOES include "Certified" ("AWS Certified Cloud
    // Practitioner"), so a model correctly using that name would otherwise trip both
    // the organisation check (phrase not found verbatim) and the credential-language
    // check (word "certified" not found verbatim) for a credential that is real.
    knownCertifications: string[] = [],
    // The JD's own gap keywords (missing/partial) for this report — deliberately narrow
    // (not free text) so the check below can't misfire on ordinary sentence vocabulary.
    // Optional and empty by default: callers with no keyword concept (CoverLetterService)
    // simply never trigger check 5.
    jdKeywords: string[] = [],
  ): FabricationCheck {
    const violations: string[] = [];
    const details: FabricationViolation[] = [];
    const source = this.normalise(sourceText);

    // ── 1. NUMBERS ──
    // The highest-risk fabrication: "improved performance" → "improved performance by
    // 40%". That 40% is a checkable claim the candidate cannot defend. Every number in
    // the output must exist in the source.
    for (const num of this.extractNumbers(newText)) {
      if (!this.sourceHasNumber(source, num)) {
        violations.push(`invented number: "${num}"`);
        details.push({
          type: 'number',
          value: num,
          missingFact:
            'a specific metric or number (e.g. a percentage, count, or dollar amount)',
        });
      }
    }

    // ── 2. YEARS / DATES ──
    for (const year of newText.match(/\b(19|20)\d{2}\b/g) ?? []) {
      if (!source.includes(year)) {
        violations.push(`invented year: "${year}"`);
        details.push({
          type: 'year',
          value: year,
          missingFact: 'a specific year or date',
        });
      }
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
      // "REST APIs", "CI/CD", "SQL Server" — jargon built entirely from common tech
      // acronyms is never an organisation claim, so checking it against known orgs
      // was a guaranteed false positive (found live: "REST APIs" in an otherwise
      // clean cover letter got rejected as an "unrecognised organisation"). A real
      // fabricated org name (e.g. "Goldman Sachs") is never built entirely from
      // these acronyms, so this can't be used to smuggle a fake employer past the
      // check — it only exempts phrases with no name-bearing word in them at all.
      if (this.isTechJargon(candidate)) continue;

      const known =
        knownOrgs.some((o) => this.orgAppearsIn(candidate, o)) ||
        allowedOrgs.some((o) => this.orgAppearsIn(candidate, o)) ||
        knownCertifications.some((c) => this.orgAppearsIn(candidate, c)) ||
        source.includes(this.normalise(candidate));
      if (!known) {
        violations.push(`unrecognised organisation: "${candidate}"`);
        details.push({
          type: 'organisation',
          value: candidate,
          missingFact: 'a specific employer, school, or organisation name',
        });
      }
    }

    // ── 4. CREDENTIAL LANGUAGE ──
    // Phrases that assert a qualification. Adding "certified" or "MSc" is a
    // categorically different lie from rephrasing a bullet.
    const credentials =
      /\b(certified|licen[cs]ed|accredited|PhD|MSc|MBA|BSc|degree in)\b/gi;
    let credentialMatch: RegExpExecArray | null;
    while ((credentialMatch = credentials.exec(newText))) {
      const word = credentialMatch[0];
      if (new RegExp(`\\b${this.escapeRegex(word)}\\b`, 'i').test(sourceText)) {
        continue; // the literal word is already in the resume — fine
      }
      // Not literal — but if the text right around the match names a certification
      // the candidate genuinely holds, that's the model using the credential's real
      // name, not inventing one (see collectKnownCertifications()'s doc comment).
      const window = this.windowAround(newText, credentialMatch.index, 60);
      const isRealCertification = knownCertifications.some((c) =>
        this.orgAppearsIn(window, c),
      );
      if (!isRealCertification) {
        violations.push(`invented credential: "${word}"`);
        details.push({
          type: 'credential',
          value: word,
          missingFact: 'a specific certification or degree',
        });
      }
    }

    // ── 5. UNSUPPORTED SKILL/TECHNOLOGY KEYWORDS ──
    // A named technology from the JD's own gap list that newText claims but that never
    // appears anywhere in the original resume — the same fabrication as an invented
    // number or employer, just for a skill. Confirmed live (2026-08-04) via a
    // cross-workspace audit: 44 of 67 real suggestions with keywordsAdded claimed a
    // keyword absent from the resume, several already accepted onto live resumes
    // (Cypress, Redux, Zustand, MQTT, Unity, C#, Git) — none of checks 1-4 above catch a
    // bare single-word skill token (the organisation check specifically requires two+
    // capitalised words in sequence).
    for (const keyword of jdKeywords) {
      if (!keyword) continue;
      const pattern = this.wordBoundaryRegex(keyword);
      if (!pattern.test(newText)) continue; // this suggestion doesn't even claim it
      if (!pattern.test(sourceText)) {
        violations.push(`unsupported skill: "${keyword}"`);
        details.push({
          type: 'keyword',
          value: keyword,
          missingFact: `evidence that you have real ${keyword} experience — this isn't mentioned anywhere in your resume`,
        });
      }
    }

    if (violations.length) {
      this.logger.warn(
        `fabrication check failed: ${violations.join('; ')} — newText="${newText.slice(0, 200)}"`,
      );
    }
    return { safe: violations.length === 0, violations, details };
  }

  /** Whole-token, case-insensitive — "Git" must appear as a word, not inside "GitHub". */
  private wordBoundaryRegex(phrase: string): RegExp {
    return new RegExp(
      `(^|[^a-zA-Z0-9])${this.escapeRegex(phrase)}([^a-zA-Z0-9]|$)`,
      'i',
    );
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

  /**
   * Certification NAMES the candidate genuinely holds — a different vocabulary from
   * collectKnownOrgs() (which reads a certification's ISSUER, e.g. "Amazon Web
   * Services", not its name). Kept separate because a certification's real/official
   * name commonly differs from how a resume shorthands it (e.g. a resume listing
   * "AWS Cloud Practitioner" while the credential's actual name is "AWS Certified
   * Cloud Practitioner") — see check()'s use of this list.
   */
  collectKnownCertifications(sections: ResumeSection[]): string[] {
    const certs: string[] = [];
    for (const s of sections) {
      if (s.sectionType === 'certifications') {
        certs.push(
          ...(s.content as CertificationItemLike[]).map((c) => c.name ?? ''),
        );
      }
    }
    return certs.filter(Boolean);
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
   * True if every word in the phrase is a common tech acronym (see TECH_ACRONYMS).
   * Deliberately NOT significantWords() — that filter drops words of length <= 2 to
   * de-noise organisation-name comparisons, but that would silently drop exactly the
   * short acronyms this check exists to recognise ("CI", "CD", "UI", "UX", "AI",
   * "ML"), making isTechJargon() never match a phrase like "CI CD".
   */
  private isTechJargon(candidate: string): boolean {
    const words = candidate
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    return words.length > 0 && words.every((w) => TECH_ACRONYMS.has(w));
  }

  /**
   * Whether known/allowed org `o` is "the same organisation" as `candidate`, tolerating
   * paraphrase — see the call site above. Word-overlap, not exact/substring match: a
   * cover letter is free to write "Senior Fullstack Developer" for a JD position of
   * "Sr. Fullstack Developer", and "Dear Stripe Hiring Team" for an allowed org of
   * "Stripe" — neither is fabrication, both are the model using words we gave it. A
   * majority of the KNOWN org's own significant words appearing in the candidate is
   * enough; a wholly different name (0% overlap) still gets flagged.
   *
   * Word matches also tolerate a small spelling variation (wordsMatch()) — found live:
   * a JD's company name never appeared anywhere in the JD's own body text (only in the
   * structured `company` field), so the model had nothing to anchor its spelling and
   * wrote "Mannaran" for the real "manaran". A single inserted letter in an unfamiliar
   * name is a typo, not a fabrication — this doesn't help "Goldman Sachs" pass against
   * "Acme Corp", since those aren't within a couple of edits of each other.
   */
  private orgAppearsIn(candidate: string, o: string): boolean {
    const orgWords = this.significantWords(o);
    if (!orgWords.length) return false; // an empty/trivial org must never match everything
    const candidateWords = this.significantWords(candidate);
    const overlap = orgWords.filter((w) =>
      candidateWords.some((cw) => this.wordsMatch(w, cw)),
    ).length;
    return overlap / orgWords.length >= 0.5;
  }

  private significantWords(s: string): string[] {
    return s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2); // drops "sr", "of", "a", ... — too generic to signal a match either way
  }

  /**
   * Exact match, or a small edit-distance match for longer words only. Tolerance
   * scales with length so short words ("aws", "ibm") still require an exact match —
   * a 1-edit typo on a 3-letter word changes 33% of it and could coincidentally land
   * on a genuinely different real name, but the same 1-edit typo on "manaran" (7
   * letters) is unmistakably the same word.
   */
  private wordsMatch(a: string, b: string): boolean {
    if (a === b) return true;
    const maxLen = Math.max(a.length, b.length);
    if (maxLen <= 3) return false;
    const tolerance = maxLen <= 6 ? 1 : 2;
    return this.levenshtein(a, b) <= tolerance;
  }

  private levenshtein(a: string, b: string): number {
    const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [
      i,
      ...new Array(b.length).fill(0),
    ]);
    for (let j = 0; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        dp[i][j] =
          a[i - 1] === b[j - 1]
            ? dp[i - 1][j - 1]
            : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
    return dp[a.length][b.length];
  }

  /** Characters immediately surrounding a match, for context-aware checks. */
  private windowAround(text: string, index: number, radius: number): string {
    return text.slice(Math.max(0, index - radius), index + radius);
  }

  private normalise(s: string): string {
    return s.toLowerCase().replace(/\s+/g, ' ');
  }

  private escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
