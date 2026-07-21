import { STEP_MANIFEST, STEP_COUNT } from './step-manifest';

describe('STEP_MANIFEST (Sprints 5-8)', () => {
  it('has 12 steps', () => {
    expect(STEP_COUNT).toBe(12);
    expect(Object.keys(STEP_MANIFEST)).toHaveLength(12);
  });

  it('progress weights sum to exactly 100', () => {
    const total = Object.values(STEP_MANIFEST).reduce(
      (n, s) => n + s.progressWeight,
      0,
    );
    expect(total).toBe(100);
  });

  it('credit weights sum to 21 (== ANALYZE_CREDIT_COST)', () => {
    const total = Object.values(STEP_MANIFEST).reduce(
      (n, s) => n + s.creditWeight,
      0,
    );
    expect(total).toBe(21);
  });

  it('every dependsOn name refers to a real step', () => {
    const names = new Set(Object.keys(STEP_MANIFEST));
    for (const [name, meta] of Object.entries(STEP_MANIFEST)) {
      for (const dep of meta.dependsOn) {
        expect(names.has(dep)).toBe(true);
        expect(dep).not.toBe(name); // no step depends on itself
      }
    }
  });

  it('generate_interview_qs, research_company, and estimate_salary depend only on parse_resume/parse_jd — not score_ats — proving they can run in parallel with the scoring branch', () => {
    expect(STEP_MANIFEST.generate_interview_qs.dependsOn).toEqual(
      expect.arrayContaining(['parse_resume', 'parse_jd']),
    );
    expect(STEP_MANIFEST.generate_interview_qs.dependsOn).not.toContain(
      'score_ats',
    );
    expect(STEP_MANIFEST.research_company.dependsOn).not.toContain('score_ats');
    expect(STEP_MANIFEST.estimate_salary.dependsOn).not.toContain('score_ats');
  });

  it('finalize depends on every other step (the DAG sink)', () => {
    const others = Object.keys(STEP_MANIFEST).filter((n) => n !== 'finalize');
    expect(STEP_MANIFEST.finalize.dependsOn.sort()).toEqual(others.sort());
  });
});
