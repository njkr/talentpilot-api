import { z } from 'zod';

export const resumeOptimizationSchema = z
  .object({
    suggestions: z.array(
      z
        .object({
          sectionType: z.enum(['summary', 'experience', 'projects', 'skills']),
          itemIndex: z
            .number()
            .nullable()
            .describe('Index of the entry within the section'),
          bulletIndex: z
            .number()
            .nullable()
            .describe(
              'Index of the bullet/highlight, or null for the whole item',
            ),
          oldText: z
            .string()
            .describe(
              'EXACT current text — must match character for character',
            ),
          newText: z.string(),
          reason: z
            .string()
            .describe('One sentence tied to a specific job requirement'),
          impact: z.enum(['high', 'medium', 'low']),
          keywordsAdded: z.array(z.string()),
        })
        .strict(),
    ),
    overallStrategy: z.string(),
  })
  .strict();

export type ResumeOptimization = z.infer<typeof resumeOptimizationSchema>;
export type ResumeOptimizationSuggestion =
  ResumeOptimization['suggestions'][number];
