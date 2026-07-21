import { z } from 'zod';

export const companySynthesisSchema = z
  .object({
    overview: z
      .string()
      .describe('2-3 sentences: what the company does, at a glance'),
    culture: z
      .array(z.string())
      .describe('Short, specific observations about working culture'),
    talkingPoints: z
      .array(z.string())
      .describe(
        'Specific things the candidate can raise to show they did their homework',
      ),
    sources: z
      .array(z.string())
      .describe('URLs actually used to support the claims above'),
    confidence: z
      .enum(['high', 'medium', 'low'])
      .describe(
        'low when search results were thin — do not pad with generalities',
      ),
  })
  .strict();

export type CompanySynthesis = z.infer<typeof companySynthesisSchema>;
