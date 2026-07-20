import { z } from 'zod';
import {
  certificationsSchema,
  educationSchema,
  experienceSchema,
  languagesSchema,
  personalInfoSchema,
  projectsSchema,
  skillsSchema,
  summarySchema,
} from './resume-sections.schema';

/**
 * The single Structured Output shape the resume-extraction prompt returns. Root MUST be
 * an object (Structured Outputs rejects an array root) — that's the only reason this
 * isn't just "an array of sections". `confidence` mirrors the other keys 1:1 so each
 * extracted section carries the model's own self-reported certainty; the parser splits
 * this one response into one ResumeSection row per key.
 */
export const resumeExtractionSchema = z
  .object({
    personalInfo: personalInfoSchema,
    summary: summarySchema,
    skills: skillsSchema,
    experience: experienceSchema,
    projects: projectsSchema,
    education: educationSchema,
    certifications: certificationsSchema,
    languages: languagesSchema,
    confidence: z
      .object({
        personalInfo: z.number(),
        summary: z.number(),
        skills: z.number(),
        experience: z.number(),
        projects: z.number(),
        education: z.number(),
        certifications: z.number(),
        languages: z.number(),
      })
      .strict(),
  })
  .strict();

export type ResumeExtraction = z.infer<typeof resumeExtractionSchema>;
