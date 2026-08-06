import { FabricationGuardService } from './fabrication-guard.service';

describe('FabricationGuardService', () => {
  const guard = new FabricationGuardService();

  it('flags a number that does not appear in the source', () => {
    const result = guard.check(
      'Improved API performance by 45%, reducing latency for 2M users',
      'Improved API performance for our main service',
      [],
    );
    expect(result.safe).toBe(false);
    expect(result.violations.some((v) => v.includes('45%'))).toBe(true);
  });

  it('accepts a number that already appears in the source, in any form', () => {
    const result = guard.check(
      'Led migration of 40 microservices to Kubernetes',
      'Led migration for 40 microservices',
      [],
    );
    expect(result.safe).toBe(true);
  });

  it('flags a year not present in the source', () => {
    const result = guard.check(
      'Joined the team in 2019 and scaled it rapidly',
      'Scaled the team rapidly over several years',
      [],
    );
    expect(result.safe).toBe(false);
    expect(result.violations.some((v) => v.includes('2019'))).toBe(true);
  });

  it('flags an organisation not in the known org list or source text', () => {
    const result = guard.check(
      'Collaborated with Goldman Sachs on a trading platform',
      'Built a trading platform for internal use',
      ['Acme Corp'],
    );
    expect(result.safe).toBe(false);
    expect(result.violations.some((v) => v.includes('Goldman Sachs'))).toBe(
      true,
    );
  });

  it('accepts an organisation that is in the known org list', () => {
    const result = guard.check(
      'Led backend development at Acme Corp',
      'Software engineer responsible for backend systems',
      ['Acme Corp'],
    );
    expect(result.safe).toBe(true);
  });

  it('accepts a known/allowed org even when it is glued to other capitalised words in the same phrase (e.g. a salutation)', () => {
    // extractCapitalisedPhrases() pulls out the whole contiguous run — "Dear Stripe
    // Hiring Team" is ONE candidate, not "Stripe" standalone. A cover letter greeting
    // the company by name (exactly what it's told to do) must not be flagged just
    // because the org name isn't the ENTIRE phrase.
    const result = guard.check(
      'Dear Stripe Hiring Team, I am excited about this role...',
      'Software engineer responsible for backend systems',
      [],
      ['Stripe'],
    );
    expect(result.safe).toBe(true);
  });

  it('still flags a wholly different fabricated org sharing no known/allowed org as a substring', () => {
    const result = guard.check(
      'Excited to leverage my time at Wayne Enterprises for this role',
      'Software engineer responsible for backend systems',
      [],
      ['Stripe'],
    );
    expect(result.safe).toBe(false);
  });

  it('flags an invented credential', () => {
    const result = guard.check(
      'Certified AWS Solutions Architect with deployment experience',
      'Deployed services to AWS regularly',
      [],
    );
    expect(result.safe).toBe(false);
    expect(result.violations.some((v) => v.includes('credential'))).toBe(true);
  });

  it('accepts a credential that is actually present in the source', () => {
    const result = guard.check(
      'Certified AWS Solutions Architect leading cloud migrations',
      'Certified AWS Solutions Architect with 5 years of experience',
      [],
    );
    expect(result.safe).toBe(true);
  });

  it('accepts a pure rephrasing with no new facts', () => {
    const result = guard.check(
      'Spearheaded backend development for the core platform',
      'Led backend development for the core platform',
      [],
    );
    expect(result.safe).toBe(true);
  });

  // ── Real failure found live: a cover letter for a resume listing "Certifications:
  // AWS Cloud Practitioner." (no institution, no issuer, and the word "certified"
  // never appears anywhere) was rejected on 9 consecutive generation attempts
  // because GPT-4o correctly used the credential's real/official name, "AWS
  // Certified Cloud Practitioner" — tripping both the organisation check (the exact
  // phrase isn't in the source) and the credential-language check (the word
  // "certified" isn't in the source) for a certification the candidate genuinely
  // holds. knownCertifications (5th arg) is the fix.
  describe('knownCertifications', () => {
    it('⚠️ accepts the credential\'s real/official name even though the resume shorthands it without "Certified" (the live bug)', () => {
      const result = guard.check(
        'As an AWS Certified Cloud Practitioner, I bring hands-on cloud experience.',
        'Certifications: AWS Cloud Practitioner.',
        [], // no employer/institution/issuer known — this resume has none
        [],
        ['AWS Cloud Practitioner'],
      );
      expect(result.safe).toBe(true);
    });

    it('without knownCertifications, the same text is flagged (proves the fix is load-bearing, not incidental)', () => {
      const result = guard.check(
        'As an AWS Certified Cloud Practitioner, I bring hands-on cloud experience.',
        'Certifications: AWS Cloud Practitioner.',
        [],
      );
      expect(result.safe).toBe(false);
    });

    it('still flags a credential with no relation to any known certification', () => {
      const result = guard.check(
        'I am a Certified Kubernetes Administrator with production experience.',
        'Certifications: AWS Cloud Practitioner.',
        [],
        [],
        ['AWS Cloud Practitioner'],
      );
      expect(result.safe).toBe(false);
      expect(result.violations.some((v) => v.includes('credential'))).toBe(
        true,
      );
    });

    it('still flags a wholly unrelated organisation even with a known certification present', () => {
      const result = guard.check(
        'I previously consulted for Goldman Sachs on cloud migrations.',
        'Certifications: AWS Cloud Practitioner.',
        [],
        [],
        ['AWS Cloud Practitioner'],
      );
      expect(result.safe).toBe(false);
      expect(result.violations.some((v) => v.includes('Goldman Sachs'))).toBe(
        true,
      );
    });
  });

  // ── Real failure found live: a cover letter containing "REST APIs" — plain tech
  // jargon, not a claim about any organisation — was rejected as an "unrecognised
  // organisation" because both words happen to be capitalised. isTechJargon() is
  // the fix: a phrase built ENTIRELY from common tech acronyms is exempt from the
  // organisation check, but a real fabricated/misspelled org name in the SAME
  // letter must still be caught.
  describe('tech jargon exemption', () => {
    it('⚠️ does not flag "REST APIs" as an unrecognised organisation (the live bug)', () => {
      const result = guard.check(
        'I have built REST APIs and scalable backend systems for years.',
        'Full Stack Developer with experience building backend systems.',
        [],
      );
      expect(result.safe).toBe(true);
    });

    it('other common tech acronym phrases are also exempt (CI/CD, SQL Server, JSON APIs)', () => {
      for (const phrase of [
        'I have hands-on experience with CI CD pipelines.',
        'Strong background in SQL databases and JSON APIs.',
      ]) {
        const result = guard.check(
          phrase,
          'Full Stack Developer with backend experience.',
          [],
        );
        expect(result.safe).toBe(true);
      }
    });

    it('a phrase mixing a tech acronym with a real fabricated name is still flagged (not every word needs to be jargon)', () => {
      const result = guard.check(
        'I led the API integration project at Wayne Enterprises.',
        'Full Stack Developer with backend experience.',
        [],
      );
      expect(result.safe).toBe(false);
      expect(
        result.violations.some((v) => v.includes('Wayne Enterprises')),
      ).toBe(true);
    });
  });

  // ── Real failure found live: the JD's company name ("manaran") never appears
  // anywhere in the JD's own body text — only in the structured `company` field —
  // so the model had nothing to anchor its spelling against and wrote "Mannaran"
  // (one inserted letter). wordsMatch()'s edit-distance tolerance is the fix.
  describe('spelling-variation tolerance', () => {
    it('⚠️ accepts a one-letter-typo variation of a known/allowed org (the live bug: "Mannaran" for "manaran")', () => {
      const result = guard.check(
        'Greetings to the Mannaran Company Hiring Team, I have built REST APIs for years.',
        'Full Stack Developer with backend experience.',
        [],
        ['manaran'],
      );
      expect(result.safe).toBe(true);
    });

    it("still flags a wholly different fabricated organisation alongside the correctly-typo'd real one", () => {
      const result = guard.check(
        'Greetings to the Mannaran Company Hiring Team — I previously consulted for Blackwood Capital Partners.',
        'Full Stack Developer with backend experience.',
        [],
        ['manaran'],
      );
      expect(result.safe).toBe(false);
      expect(
        result.violations.some((v) => v.includes('Blackwood Capital')),
      ).toBe(true);
      expect(result.violations.some((v) => v.includes('Mannaran'))).toBe(false);
    });

    it('does NOT fuzzy-match short (<=3 letter) words — a typo on a short acronym could coincidentally be a different real name', () => {
      // "IBM" vs "ITM" is a 1-edit difference but both are plausible real orgs —
      // short words must match exactly, not fuzzily. A single-word known org
      // isolates this: with a longer org name, overlap on the OTHER words could
      // pass the 50% threshold on its own regardless of the short word.
      const result = guard.check(
        'Greetings to the ITM Hiring Team, excited about this role.',
        'Full Stack Developer with backend experience.',
        [],
        ['IBM'],
      );
      expect(result.safe).toBe(false);
    });

    it('does not tolerate a wholly different word of similar length (edit distance is still bounded)', () => {
      const result = guard.check(
        'I previously worked with Zambezi Corporation on a similar project.',
        'Full Stack Developer with backend experience.',
        [],
        ['manaran'],
      );
      expect(result.safe).toBe(false);
    });
  });

  // ── Randomized coverage across varied resume/cover-letter shapes, per the request
  // to test cover letter generation with "random data" rather than one fixed
  // fixture — the live bugs above were each found on a SPECIFIC resume shape a
  // hand-picked fixture wouldn't necessarily reproduce.
  describe('randomized resume/cover-letter combinations', () => {
    const COMPANIES = [
      'Acme Corp',
      'Globex',
      'Initech',
      'Umbrella Inc',
      'manaran',
    ];
    const CERTS = [
      'AWS Cloud Practitioner',
      'PMP',
      'Scrum Master',
      'Google Cloud Associate Engineer',
    ];
    const TECH_PHRASES = [
      'REST APIs',
      'CI CD pipelines',
      'SQL databases',
      'JSON payloads',
      'HTML and CSS',
    ];
    const JD_COMPANIES = ['Stripe', 'Notion', 'Figma', 'Vercel', 'manaran'];

    function pick<T>(arr: T[], seed: number): T {
      return arr[seed % arr.length];
    }

    // 20 pseudo-random combinations (deterministic across runs via a simple seed,
    // so a failure is always reproducible) covering every company/cert/phrase pair.
    const cases = Array.from({ length: 20 }, (_, i) => ({
      company: pick(COMPANIES, i),
      cert: pick(CERTS, i * 3 + 1),
      techPhrase: pick(TECH_PHRASES, i * 7 + 2),
      jdCompany: pick(JD_COMPANIES, i * 5 + 3),
    }));

    it.each(cases)(
      'accepts a clean letter built only from real resume facts + tech jargon + the JD company (case %#: $company / $cert / $techPhrase / $jdCompany)',
      ({ company, cert, techPhrase, jdCompany }) => {
        const resume = `Experience: Software Engineer at ${company}. Certifications: ${cert}.`;
        const letter =
          `Dear ${jdCompany} Hiring Team, as a Software Engineer at ${company} ` +
          `I have hands-on experience with ${techPhrase} and hold a ${cert} certification.`;

        const result = guard.check(
          letter,
          resume,
          [company],
          [jdCompany],
          [cert],
        );

        expect(result.safe).toBe(true);
      },
    );

    it.each(cases)(
      'still flags a fabricated org injected into the same clean letter (case %#)',
      ({ company, cert, techPhrase }) => {
        const resume = `Experience: Software Engineer at ${company}. Certifications: ${cert}.`;
        const letter =
          `As a Software Engineer at ${company}, I previously consulted for ` +
          `Blackwood Capital Partners and have experience with ${techPhrase}.`;

        const result = guard.check(letter, resume, [company], [], [cert]);

        expect(result.safe).toBe(false);
        expect(
          result.violations.some((v) => v.includes('Blackwood Capital')),
        ).toBe(true);
      },
    );

    it.each(cases)(
      'still flags a fabricated number injected into the same clean letter (case %#)',
      ({ company, cert }) => {
        const resume = `Experience: Software Engineer at ${company}. Certifications: ${cert}.`;
        const letter = `At ${company} I improved system performance by 73%.`;

        const result = guard.check(letter, resume, [company]);

        expect(result.safe).toBe(false);
        expect(result.violations.some((v) => v.includes('73%'))).toBe(true);
      },
    );
  });

  describe('details (structured companion to violations)', () => {
    it('carries the invented number as a "number" detail with its value and what fact is missing', () => {
      const result = guard.check(
        'Improved API performance by 45%, reducing latency for 2M users',
        'Improved API performance for our main service',
        [],
      );
      expect(result.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'number', value: '45%' }),
        ]),
      );
      expect(
        result.details.find((d) => d.value === '45%')?.missingFact,
      ).toMatch(/metric|number/);
    });

    it('carries an invented organisation as an "organisation" detail', () => {
      const result = guard.check(
        'Collaborated with Goldman Sachs on a trading platform',
        'Built a trading platform for internal use',
        ['Acme Corp'],
      );
      expect(result.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'organisation',
            value: 'Goldman Sachs',
          }),
        ]),
      );
    });

    it('carries an invented credential as a "credential" detail', () => {
      const result = guard.check(
        'Certified AWS Solutions Architect with deployment experience',
        'Deployed services to AWS regularly',
        [],
      );
      expect(result.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'credential', value: 'Certified' }),
        ]),
      );
    });

    it('is an empty array when the text is safe', () => {
      const result = guard.check(
        'Led migration of 40 microservices to Kubernetes',
        'Led migration for 40 microservices',
        [],
      );
      expect(result.safe).toBe(true);
      expect(result.details).toEqual([]);
    });
  });

  // ── Found live 2026-08-04: none of checks 1-4 catch a bare single-word skill
  // token, since the organisation check requires two+ capitalised words in sequence.
  // A cross-workspace audit found 44 real suggestions claiming a keyword absent from
  // the resume, several already accepted onto live resumes (Cypress, Redux, Unity).
  describe('unsupported skill/technology keywords (6th arg: jdKeywords)', () => {
    it('flags a JD keyword claimed in newText but absent from the whole resume', () => {
      const result = guard.check(
        'Jest, Cypress',
        'Experienced with Jest for unit testing.',
        [],
        [],
        [],
        ['Cypress'],
      );
      expect(result.safe).toBe(false);
      expect(result.violations.some((v) => v.includes('Cypress'))).toBe(true);
      expect(result.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'keyword', value: 'Cypress' }),
        ]),
      );
    });

    it('does not flag "GitHub" as evidence for a bare "Git" claim (whole-token match)', () => {
      const result = guard.check(
        'Automated CI/CD pipelines with GitHub Actions and Git.',
        'Automated CI/CD pipelines with GitHub Actions.',
        [],
        [],
        [],
        ['Git'],
      );
      expect(result.safe).toBe(false);
      expect(result.violations.some((v) => v.includes('"Git"'))).toBe(true);
    });

    it('accepts a JD keyword that is genuinely evidenced elsewhere in the resume', () => {
      const result = guard.check(
        'Skilled in Git version control for collaborative development.',
        'Experience using Git for version control across all projects.',
        [],
        [],
        [],
        ['Git'],
      );
      expect(result.safe).toBe(true);
    });

    it('does not flag a JD keyword the suggestion never actually claims', () => {
      const result = guard.check(
        'Spearheaded backend development for the core platform',
        'Led backend development for the core platform',
        [],
        [],
        [],
        ['Unity', 'C#'],
      );
      expect(result.safe).toBe(true);
    });

    it('stays backward compatible when jdKeywords is omitted', () => {
      const result = guard.check(
        'Jest, Cypress',
        'Experienced with Jest for unit testing.',
        [],
      );
      expect(result.safe).toBe(true);
    });
  });

  describe('summariseForNeedsInfo', () => {
    it('flags needsDirectEdit for a keyword violation, with skill-specific direct-edit guidance', () => {
      const check = guard.check(
        'Jest, Cypress',
        'Experienced with Jest for unit testing.',
        [],
        [],
        [],
        ['Cypress'],
      );
      const summary = guard.summariseForNeedsInfo(check);
      expect(summary.needsDirectEdit).toBe(true);
      expect(summary.exampleValue).toBeNull();
      expect(summary.missingFact).toContain('Cypress');
      expect(summary.missingFact).toMatch(
        /add it to your Skills section directly/,
      );
    });

    it('does not flag needsDirectEdit for a non-keyword violation (falls back to generic guidance)', () => {
      const check = guard.check(
        'Collaborated with Goldman Sachs on a trading platform',
        'Built a trading platform for internal use',
        ['Acme Corp'],
      );
      const summary = guard.summariseForNeedsInfo(check);
      expect(summary.needsDirectEdit).toBe(false);
      expect(summary.exampleValue).toBe('Goldman Sachs');
      expect(summary.missingFact).toContain('organisation');
    });
  });
});
