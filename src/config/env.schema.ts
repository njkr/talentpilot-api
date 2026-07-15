import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.string().default('3000'),
  APP_URL: z.string().url().default('http://localhost:3000'),

  DATABASE_URL: z.string().url(),
  DB_POOL_SIZE: z.coerce.number().default(10),
  REDIS_URL: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TTL_DAYS: z.coerce.number().default(30),

  RESEND_API_KEY: z.string().startsWith('re_'),
  EMAIL_FROM: z.string().email(),

  OTP_TTL_MIN: z.coerce.number().default(10),
  OTP_MAX_ATTEMPTS: z.coerce.number().default(5),
  OTP_RESEND_COOLDOWN_SEC: z.coerce.number().default(60),
  RESET_TTL_MIN: z.coerce.number().default(30),
});

export type EnvType = z.infer<typeof envSchema>;

export const validateEnv = (raw: Record<string, unknown>): EnvType => {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    // Print EVERY missing var, not just the first. Nothing is worse than fixing
    // env vars one boot at a time.
    const issues = parsed.error.issues
      .map((i) => `  ✗ ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return parsed.data;
};
