import { z } from 'zod';
import type { SectionType } from '../../resumes/entities/resume-section.entity';

/**
 * Structured Outputs rules apply to every object here: no `.optional()` (use
 * `.nullable()` — the field must always be present, even if empty), and every object
 * needs `.strict()` so the SDK emits `additionalProperties: false`.
 */

export const personalInfoSchema = z
  .object({
    fullName: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    location: z.string().nullable(),
    links: z.array(z.object({ label: z.string(), url: z.string() }).strict()),
  })
  .strict();

export const summarySchema = z
  .object({
    text: z.string().nullable(),
  })
  .strict();

export const skillsSchema = z.array(z.string());

export const experienceItemSchema = z
  .object({
    company: z.string().nullable(),
    title: z.string().nullable(),
    location: z.string().nullable(),
    startDate: z.string().nullable(), // free text: resumes write "Jan 2020", "2020", "Summer 2019"
    endDate: z.string().nullable(), // null when isCurrent
    isCurrent: z.boolean(),
    highlights: z.array(z.string()),
  })
  .strict();
export const experienceSchema = z.array(experienceItemSchema);

export const projectItemSchema = z
  .object({
    name: z.string().nullable(),
    description: z.string().nullable(),
    url: z.string().nullable(),
    technologies: z.array(z.string()),
  })
  .strict();
export const projectsSchema = z.array(projectItemSchema);

export const educationItemSchema = z
  .object({
    institution: z.string().nullable(),
    degree: z.string().nullable(),
    field: z.string().nullable(),
    startDate: z.string().nullable(),
    endDate: z.string().nullable(),
  })
  .strict();
export const educationSchema = z.array(educationItemSchema);

export const certificationItemSchema = z
  .object({
    name: z.string().nullable(),
    issuer: z.string().nullable(),
    date: z.string().nullable(),
  })
  .strict();
export const certificationsSchema = z.array(certificationItemSchema);

export const languageItemSchema = z
  .object({
    name: z.string().nullable(),
    proficiency: z.string().nullable(), // free text: "native", "conversational", "B2"
  })
  .strict();
export const languagesSchema = z.array(languageItemSchema);

/**
 * One schema per SectionType, reused in two places: composed into the top-level
 * extraction schema below, and used standalone by the Sections API to validate a user's
 * edit before it overwrites resume_sections.content. Keyed by the same SectionType union
 * the entity uses, so adding a section type is a compile error here until both exist.
 */
export const SECTION_SCHEMAS: Record<SectionType, z.ZodType> = {
  personal_info: personalInfoSchema,
  summary: summarySchema,
  skills: skillsSchema,
  experience: experienceSchema,
  projects: projectsSchema,
  education: educationSchema,
  certifications: certificationsSchema,
  languages: languagesSchema,
};
