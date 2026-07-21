import { SemanticScoreResult } from './services/semantic-scorer.service';
import { KeywordMatch } from './services/keyword-matcher.service';

/** MatchKeywordsStep's output artifact — everything AtsService needs to grade. */
export interface MatchData {
  semantic: SemanticScoreResult;
  keywords: KeywordMatch[];
}
