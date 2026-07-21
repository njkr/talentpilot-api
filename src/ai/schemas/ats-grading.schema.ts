import { z } from 'zod';

export const atsGradingSchema = z
  .object({
    experienceScore: z
      .number()
      .describe('0-100: years, seniority, and domain relevance'),
    educationScore: z
      .number()
      .nullable()
      .describe('null if the JD states no education requirement'),
    projectScore: z
      .number()
      .describe('0-100: project relevance and demonstrated outcomes'),
    grammarScore: z
      .number()
      .describe('0-100: grammar, consistency, professional tone'),
    grammarIssues: z.array(z.string()),
    summary: z.string().describe('3-4 sentences, addressed to the candidate'),
    strengths: z.array(z.string()),
    weaknesses: z.array(z.string()),
    recommendations: z
      .array(z.string())
      .describe('Concrete, ordered by impact'),
  })
  .strict();

export type AtsGrading = z.infer<typeof atsGradingSchema>;
