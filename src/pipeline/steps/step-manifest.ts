/**
 * Single source of truth for step metadata (name, DAG edges, progress/credit weights) —
 * plain data, no DI, no dependency on AiService/EmbeddingsService/etc. Each PipelineStep
 * subclass reads its own entry from here instead of hardcoding the same numbers twice,
 * and WorkspacesService (API process) imports this directly for `stepsTotal` instead of
 * injecting the real StepRegistry, which would drag the whole worker-only AI dependency
 * graph (AiService, EmbeddingsService, AtsService, ...) into the API process's DI graph.
 *
 * StepRegistry.assertValid() (worker-side) still validates the real step instances at
 * boot — this manifest is what keeps those instances' properties from drifting from
 * what this file, and thus the API process, believes is true.
 */
interface StepMeta {
  dependsOn: string[];
  progressWeight: number;
  creditWeight: number;
}

export const STEP_MANIFEST: Record<
  | 'parse_resume'
  | 'parse_jd'
  | 'generate_embeddings'
  | 'match_keywords'
  | 'score_ats',
  StepMeta
> = {
  parse_resume: { dependsOn: [], progressWeight: 15, creditWeight: 2 },
  parse_jd: { dependsOn: [], progressWeight: 10, creditWeight: 1 },
  generate_embeddings: {
    dependsOn: ['parse_resume', 'parse_jd'],
    progressWeight: 20,
    creditWeight: 2,
  },
  match_keywords: {
    dependsOn: ['generate_embeddings'],
    progressWeight: 30,
    creditWeight: 3,
  },
  score_ats: {
    dependsOn: ['match_keywords'],
    progressWeight: 25,
    creditWeight: 3,
  },
};

export type StepName = keyof typeof STEP_MANIFEST;

export const STEP_COUNT = Object.keys(STEP_MANIFEST).length;
