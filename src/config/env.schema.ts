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

  // Storage — same vars work for AWS S3, Cloudflare R2, MinIO
  S3_ENDPOINT: z.string().url().optional(), // omit for real AWS; set for R2/MinIO
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string(),
  S3_ACCESS_KEY: z.string(),
  S3_SECRET_KEY: z.string(),
  // z.coerce.boolean(), NOT z.stringbool(), would silently coerce the STRING "false" to
  // `true` — Boolean("false") is true in JS, since any non-empty string is truthy. That
  // bug is exactly why SSE stayed on against MinIO even with this var set to "false".
  S3_FORCE_PATH_STYLE: z.stringbool().default(false), // MinIO needs true
  // SSE-S3 (AES256) at rest — real AWS S3 supports this with zero extra setup, but
  // plain MinIO rejects it ("NotImplemented: KMS not configured") unless you stand up
  // a KMS backend. Default true for real S3/R2; set false for local MinIO dev.
  S3_SERVER_SIDE_ENCRYPTION: z.stringbool().default(true),
  SIGNED_URL_TTL_SEC: z.coerce.number().default(900), // 15 min

  // Upload limits
  MAX_FILE_SIZE_MB: z.coerce.number().default(10),
  MAX_RESUME_PAGES: z.coerce.number().default(15),
  MIN_EXTRACTED_CHARS: z.coerce.number().default(200),

  // AI gateway — every AI feature from Sprint 3 on calls AiService.complete(), which
  // reads all of these. Get this section wrong and it's silent everywhere at once.
  OPENAI_API_KEY: z.string().startsWith('sk-'),
  OPENAI_TIMEOUT_MS: z.coerce.number().default(60_000),
  OPENAI_MAX_RETRIES: z.coerce.number().default(3),
  OPENAI_CONCURRENCY: z.coerce.number().default(5), // in-flight calls per process

  AI_USER_DAILY_BUDGET_USD: z.coerce.number().default(2),
  AI_GLOBAL_DAILY_BUDGET_USD: z.coerce.number().default(50),
  AI_KILL_SWITCH: z.stringbool().default(false), // flip to stop ALL AI instantly

  // Credits — a minimal real ledger (Sprint 5), not a full billing system. New users
  // get this many free credits on signup; a full analysis costs ANALYZE_CREDIT_COST
  // (src/workspaces/workspaces.service.ts) of them.
  SIGNUP_CREDIT_GRANT: z.coerce.number().default(100),
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
