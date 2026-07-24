import { Injectable } from '@nestjs/common';
import { RequirementMatch } from '../../embeddings/embeddings.service';

/**
 * ⚠️ Raw cosine similarity is NOT a score. This is the single most misleading thing about
 * embeddings, and skipping this step makes the ATS number useless.
 *
 * Calibrated 2026-07-21 against 10 real resume/JD pairs on text-embedding-3-small with
 * section-aware chunking. Observed ranges on THIS stack (requirement vs. best-matching
 * resume chunk, not two arbitrary sentences):
 *
 *   0.30 – 0.38   unrelated / weak
 *   0.38 – 0.45   adjacent tech, same domain
 *   0.45 – 0.52   partial match
 *   0.52 – 0.58   strong match — the practical ceiling for a real requirement/bullet
 *                 pair, NOT 0.80. A prior CEIL of 0.80 was essentially unreachable for
 *                 this embedding model on this kind of short, requirement-vs-bullet
 *                 text, which compressed every real candidate into a 20-50 band no
 *                 matter how strong the actual match was.
 *   > 0.60        near-identical phrasing (rare in practice)
 *
 * These constants are calibration, not truth. RE-DERIVE THEM if you change the
 * embedding model, the chunker, or how chunks are labelled/sectioned.
 */
const FLOOR = 0.32; // at or below → 0
const CEIL = 0.62; // at or above → 100

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
