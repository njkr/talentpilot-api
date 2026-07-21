import { Injectable } from '@nestjs/common';
import { RequirementMatch } from '../../embeddings/embeddings.service';

/**
 * ⚠️ Raw cosine similarity is NOT a score. This is the single most misleading thing about
 * embeddings, and skipping this step makes the ATS number useless.
 *
 * Observed ranges for text-embedding-3-small on professional English text:
 *
 *   0.20 – 0.35   unrelated (a JD requirement vs a random resume bullet)
 *   0.35 – 0.45   same domain, different thing ("React" vs "Vue")
 *   0.45 – 0.60   partial / related match
 *   0.60 – 0.75   good match
 *   0.75 – 0.90   near-identical phrasing
 *   > 0.90        essentially the same sentence
 *
 * Two truly unrelated professional texts almost never score below 0.20, because they
 * share register, vocabulary, and structure. Mapping cosine → percentage directly gives
 * every candidate ~45%, and the score can't discriminate. Rescaling the USEFUL band to
 * 0-100 is what makes the number mean anything.
 *
 * These constants are calibration, not truth — see scripts/calibrate-semantic.ts.
 * Re-derive them from real data if the embedding model changes.
 */
const FLOOR = 0.3; // at or below → 0
const CEIL = 0.8; // at or above → 100

const IMPORTANCE_WEIGHT = {
  required: 3,
  preferred: 2,
  nice_to_have: 1,
} as const;
type Importance = keyof typeof IMPORTANCE_WEIGHT;

export interface ScoredRequirement {
  requirement: string;
  importance: Importance;
  rawSimilarity: number;
  score: number;
  evidence: string | null;
  foundIn: string | null;
  verdict: 'strong' | 'partial' | 'weak';
}

export interface SemanticScoreResult {
  semanticScore: number;
  perRequirement: ScoredRequirement[];
}

@Injectable()
export class SemanticScorerService {
  score(matches: RequirementMatch[]): SemanticScoreResult {
    if (!matches.length) return { semanticScore: 0, perRequirement: [] };

    const scored: ScoredRequirement[] = matches.map((m) => {
      const raw = Number(m.similarity);
      const normalized = Math.max(
        0,
        Math.min(1, (raw - FLOOR) / (CEIL - FLOOR)),
      );
      const importance = (m.importance ?? 'preferred') as Importance;
      return {
        requirement: m.requirement,
        importance,
        rawSimilarity: Number(raw.toFixed(4)),
        score: Math.round(normalized * 100),
        evidence: m.best_chunk?.slice(0, 300) ?? null,
        foundIn: m.section_label ?? m.section_type ?? null,
        // Bands the UI renders as ✅ / ⚠️ / ❌ — more honest than a bare number.
        verdict:
          normalized >= 0.6 ? 'strong' : normalized >= 0.3 ? 'partial' : 'weak',
      };
    });

    // Weighted mean: failing a "required" item must hurt ~3x more than a "nice to have".
    // A plain average lets a candidate ace the trivia and miss the core requirement while
    // still scoring well.
    const totalWeight = scored.reduce(
      (s, r) => s + IMPORTANCE_WEIGHT[r.importance],
      0,
    );
    const weighted = scored.reduce(
      (s, r) => s + r.score * IMPORTANCE_WEIGHT[r.importance],
      0,
    );

    return {
      semanticScore: Math.round(weighted / totalWeight),
      perRequirement: scored,
    };
  }
}
