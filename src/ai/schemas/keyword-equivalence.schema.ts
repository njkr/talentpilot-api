import { z } from 'zod';

export const keywordEquivalenceSchema = z
  .object({
    matches: z.array(
      z
        .object({
          keyword: z.string(),
          status: z.enum(['matched', 'partial', 'missing']),
          evidence: z
            .string()
            .nullable()
            .describe('Exact quote from the resume, or null'),
          reasoning: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

export type KeywordEquivalence = z.infer<typeof keywordEquivalenceSchema>;
