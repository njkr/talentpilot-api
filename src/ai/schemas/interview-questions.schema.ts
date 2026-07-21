import { z } from 'zod';

export const interviewQuestionsSchema = z
  .object({
    questions: z.array(
      z
        .object({
          type: z.enum([
            'hr',
            'behavioral',
            'technical',
            'coding',
            'system_design',
          ]),
          difficulty: z.enum(['easy', 'medium', 'hard']),
          question: z.string(),
          idealAnswer: z
            .string()
            .describe("A model answer grounded in THIS candidate's experience"),
          framework: z.string().nullable().describe('e.g. STAR, or null'),
          whyAsked: z.string().describe('What the interviewer is testing'),
          basedOn: z
            .string()
            .nullable()
            .describe('Which resume item or JD requirement prompted this'),
        })
        .strict(),
    ),
  })
  .strict();

export type InterviewQuestions = z.infer<typeof interviewQuestionsSchema>;
