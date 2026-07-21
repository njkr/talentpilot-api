import { z } from 'zod';

export const learningRoadmapSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            title: z.string(),
            gapReason: z
              .string()
              .describe('Plainly why this matters for THIS job'),
            resourceType: z.enum([
              'documentation',
              'course',
              'book',
              'project',
              'other',
            ]),
            url: z
              .string()
              .nullable()
              .describe(
                'null if not confident a real URL exists — name it in title instead',
              ),
            estHours: z.number(),
            priority: z.enum(['required', 'preferred']),
          })
          .strict(),
      )
      .max(6),
  })
  .strict();

export type LearningRoadmapOutput = z.infer<typeof learningRoadmapSchema>;
