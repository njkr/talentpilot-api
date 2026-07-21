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
 *
 * Sprints 7-8 add the optimisation/cover-letter branch and the four parallel JD-only
 * generators. Progress weights sum to exactly 100; credit weights sum to 21 (the flat
 * cost of a full analysis — see ANALYZE_CREDIT_COST in workspaces.service.ts).
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
  | 'score_ats'
  | 'optimize_resume'
  | 'generate_cover_letter'
  | 'generate_interview_qs'
  | 'build_learning_path'
  | 'research_company'
  | 'estimate_salary'
  | 'finalize',
  StepMeta
> = {
  parse_resume: { dependsOn: [], progressWeight: 8, creditWeight: 2 },
  parse_jd: { dependsOn: [], progressWeight: 6, creditWeight: 1 },
  generate_embeddings: {
    dependsOn: ['parse_resume', 'parse_jd'],
    progressWeight: 6,
    creditWeight: 1,
  },
  match_keywords: {
    dependsOn: ['generate_embeddings'],
    progressWeight: 10,
    creditWeight: 2,
  },
  score_ats: {
    dependsOn: ['match_keywords'],
    progressWeight: 12,
    creditWeight: 2,
  },
  optimize_resume: {
    dependsOn: ['score_ats'],
    progressWeight: 16,
    creditWeight: 4,
  },
  generate_cover_letter: {
    dependsOn: ['optimize_resume'],
    progressWeight: 10,
    creditWeight: 3,
  },
  generate_interview_qs: {
    // NOT score_ats — runs in parallel with the whole scoring branch.
    dependsOn: ['parse_resume', 'parse_jd'],
    progressWeight: 10,
    creditWeight: 2,
  },
  build_learning_path: {
    dependsOn: ['score_ats'], // needs the gap list
    progressWeight: 6,
    creditWeight: 1,
  },
  research_company: {
    dependsOn: ['parse_jd'],
    progressWeight: 6,
    creditWeight: 1,
  },
  estimate_salary: {
    dependsOn: ['parse_jd'],
    progressWeight: 4,
    creditWeight: 1,
  },
  finalize: {
    dependsOn: [
      'parse_resume',
      'parse_jd',
      'generate_embeddings',
      'match_keywords',
      'score_ats',
      'optimize_resume',
      'generate_cover_letter',
      'generate_interview_qs',
      'build_learning_path',
      'research_company',
      'estimate_salary',
    ],
    progressWeight: 6,
    creditWeight: 1,
  },
};

export type StepName = keyof typeof STEP_MANIFEST;

export const STEP_COUNT = Object.keys(STEP_MANIFEST).length;
