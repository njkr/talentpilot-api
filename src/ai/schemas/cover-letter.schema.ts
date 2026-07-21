import { z } from 'zod';

export const coverLetterSchema = z
  .object({
    content: z.string().describe('The full cover letter body, ready to send'),
  })
  .strict();

export type CoverLetterOutput = z.infer<typeof coverLetterSchema>;
