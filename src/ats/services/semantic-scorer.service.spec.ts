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
    const result = scorer.score([
      match(0.7, 'required'),
      match(0.5, 'required'),
      match(0.2, 'required'),
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
});
