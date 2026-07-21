import { z } from 'zod';

// Same Structured Outputs rules as Sprint 3: no .optional() (use .nullable()), every
// object .strict(), root is an object not an array.
export const jdAnalysisSchema = z
  .object({
    company: z.string().nullable(),
    position: z.string(),
    seniority: z.enum([
      'intern',
      'junior',
      'mid',
      'senior',
      'lead',
      'principal',
      'unknown',
    ]),
    employmentType: z.string().nullable(),
    location: z.string().nullable(),
    remoteType: z.enum(['onsite', 'hybrid', 'remote', 'unknown']),
    experienceRequired: z.string().nullable(),

    salary: z
      .object({
        min: z.number().nullable(),
        max: z.number().nullable(),
        currency: z.string().nullable(),
      })
      .strict(),

    // Requirements are what we embed and score against — one atomic statement each.
    requirements: z.array(
      z
        .object({
          text: z.string().describe('One atomic requirement, self-contained'),
          category: z.enum([
            'technical',
            'experience',
            'education',
            'soft_skill',
            'other',
          ]),
          importance: z.enum(['required', 'preferred', 'nice_to_have']),
        })
        .strict(),
    ),

    // Skills are what we keyword-match. Kept separate from requirements deliberately:
    // "5+ years with distributed systems" is a requirement; "Kafka" is a skill.
    skills: z.array(
      z
        .object({
          name: z
            .string()
            .describe('Canonical name, e.g. "PostgreSQL" not "postgres db"'),
          category: z.enum([
            'language',
            'framework',
            'tool',
            'cloud',
            'database',
            'soft',
            'domain',
          ]),
          importance: z.enum(['required', 'preferred', 'nice_to_have']),
        })
        .strict(),
    ),

    responsibilities: z.array(z.string()),
    keywords: z
      .array(z.string())
      .describe('ATS-relevant terms including exact phrasings used'),
  })
  .strict();

export type JdAnalysis = z.infer<typeof jdAnalysisSchema>;
