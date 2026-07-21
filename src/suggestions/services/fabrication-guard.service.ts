import { Injectable, Logger } from '@nestjs/common';

export interface FabricationCheck {
  safe: boolean;
  violations: string[];
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
    for (const candidate of this.extractCapitalisedPhrases(newText)) {
      const known =
        knownOrgs.some((o) => this.loose(o) === this.loose(candidate)) ||
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
    const matches =
      text.match(/\b[A-Z][a-zA-Z0-9&.'-]+(?:\s+[A-Z][a-zA-Z0-9&.'-]+)+/g) ?? [];
    const STOPWORDS =
      /^(The|A|An|And|For|With|At|In|On|To|Of|By|Led|Built|Designed|Managed)\b/;
    return matches.filter((m) => !STOPWORDS.test(m));
  }

  private normalise(s: string): string {
    return s.toLowerCase().replace(/\s+/g, ' ');
  }

  private loose(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
