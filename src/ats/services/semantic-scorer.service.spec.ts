import { SemanticScorerService } from './semantic-scorer.service';
import { RequirementMatch } from '../../embeddings/embeddings.service';

function match(similarity: number, importance: string): RequirementMatch {
  return {
    requirement_index: 0,
    requirement: 'req',
    importance,
    best_chunk: 'chunk',
    section_type: 'experience',
    section_label: 'label',
    similarity: String(similarity),
  };
}

describe('SemanticScorerService', () => {
  const scorer = new SemanticScorerService();

  it('returns 0 for no matches', () => {
    expect(scorer.score([])).toEqual({ semanticScore: 0, perRequirement: [] });
  });

  it('scores near-identical text close to 100 and unrelated text close to 0', () => {
    const same = scorer.score([match(0.98, 'required')]);
    expect(same.semanticScore).toBeGreaterThan(95);

    const unrelated = scorer.score([match(0.28, 'required')]);
    expect(unrelated.semanticScore).toBeLessThan(10);
  });

  it('discriminates a good match from a poor one by a wide margin', () => {
    const good = scorer.score([match(0.7, 'required')]);
    const poor = scorer.score([match(0.4, 'required')]);
    expect(good.semanticScore - poor.semanticScore).toBeGreaterThan(40);
  });

  it('weights required requirements far more than nice-to-haves', () => {
    const a = scorer.score([
      match(0.3, 'required'),
      match(0.85, 'nice_to_have'),
    ]);
    const b = scorer.score([
      match(0.85, 'required'),
      match(0.3, 'nice_to_have'),
    ]);
    expect(b.semanticScore).toBeGreaterThan(a.semanticScore + 25);
  });

  it('labels verdicts using the same normalized bands as the score', () => {
    // Values chosen against the 2026-07-21 calibration (FLOOR 0.32, CEIL 0.62):
    // 0.55 -> normalized 0.77 (strong), 0.45 -> 0.43 (partial), 0.25 -> below floor (weak).
    const result = scorer.score([
      match(0.55, 'required'),
      match(0.45, 'required'),
      match(0.25, 'required'),
    ]);
    expect(result.perRequirement.map((r) => r.verdict)).toEqual([
      'strong',
      'partial',
      'weak',
    ]);
  });

  it('defaults missing importance to preferred', () => {
    const result = scorer.score([
      { ...match(0.7, 'required'), importance: null },
    ]);
    expect(result.perRequirement[0].importance).toBe('preferred');
  });

  it('a genuinely strong-match resume scores well above a genuinely weak one', () => {
    // Raw similarities are real captured values from a live calibration pass (see the
    // service's own header comment) — a strong candidate against required skills like
    // "5+ yrs Node.js" (0.5597) and "PostgreSQL" (0.5605), vs. a weak one only hitting
    // adjacent/preferred terms like "Kafka" (0.3923) and "AWS" (0.3916).
    const strong = scorer.score([
      match(0.5597, 'required'),
      match(0.5357, 'required'),
      match(0.5605, 'required'),
      match(0.4834, 'required'),
    ]);
    const weak = scorer.score([
      match(0.4075, 'required'),
      match(0.3923, 'preferred'),
      match(0.3916, 'preferred'),
    ]);

    expect(strong.semanticScore).toBeGreaterThan(60);
    expect(weak.semanticScore).toBeLessThan(35);
    expect(strong.semanticScore - weak.semanticScore).toBeGreaterThan(30);
  });
});
