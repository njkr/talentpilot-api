import { z } from 'zod';

export const salaryEstimateSchema = z
  .object({
    currency: z.string().describe('ISO 4217 code, e.g. USD'),
    p25: z.number(),
    p50: z.number(),
    p75: z.number(),
    methodology: z
      .string()
      .describe(
        'What this estimate is based on — be honest if the basis is weak',
      ),
    factors: z
      .array(z.string())
      .describe(
        'Location cost-of-living and seniority adjustments, explicitly',
      ),
    negotiationTips: z
      .array(z.string())
      .describe("Specific to this role and this candidate's leverage"),
  })
  .strict();

export type SalaryEstimateOutput = z.infer<typeof salaryEstimateSchema>;
