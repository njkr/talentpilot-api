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
});
