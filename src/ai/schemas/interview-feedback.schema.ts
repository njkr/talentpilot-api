import { z } from 'zod';

export const interviewFeedbackSchema = z
  .object({
    feedback: z
      .string()
      .describe('Specific, actionable feedback on the candidate answer'),
    score: z
      .number()
      .describe('0-100: how well the answer addresses the question'),
  })
  .strict();

export type InterviewFeedback = z.infer<typeof interviewFeedbackSchema>;
