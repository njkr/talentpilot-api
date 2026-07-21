import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { resumeExtractionSchema } from './resume-extraction.schema';
import { jdAnalysisSchema } from './jd-analysis.schema';
import { keywordEquivalenceSchema } from './keyword-equivalence.schema';
import { atsGradingSchema } from './ats-grading.schema';

/**
 * PromptTemplate rows store `schemaKey` as a plain string (jsonb/DB can't hold a Zod
 * type), so this is the one place that string gets turned back into the real schema.
 * Add an entry here whenever a new prompt needs Structured Outputs.
 */
export const SCHEMA_REGISTRY = {
  resume_extraction: resumeExtractionSchema,
  jd_analysis: jdAnalysisSchema,
  keyword_equivalence: keywordEquivalenceSchema,
  ats_grading: atsGradingSchema,
} as const satisfies Record<string, z.ZodType>;

export type SchemaKey = keyof typeof SCHEMA_REGISTRY;

export function getSchema(schemaKey: string): z.ZodType {
  const schema = SCHEMA_REGISTRY[schemaKey as SchemaKey];
  if (!schema) {
    throw new Error(
      `Unknown schema key "${schemaKey}" — add it to SCHEMA_REGISTRY`,
    );
  }
  return schema;
}

/** OpenAI requires the response_format `name` to match `^[a-zA-Z0-9_-]+$` — schemaKey already does. */
export function getResponseFormat(schemaKey: string) {
  return zodResponseFormat(getSchema(schemaKey), schemaKey);
}
