import { config as loadEnv } from 'dotenv';
import { z } from 'zod';
import { resolve } from 'node:path';

// Load the repo-root .env (server runs from apps/server).
loadEnv({ path: resolve(process.cwd(), '../../.env') });
loadEnv(); // also allow a local .env override

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SERVER_PORT: z.coerce.number().default(4000),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.coerce.number().default(900),
  JWT_REFRESH_TTL: z.coerce.number().default(2_592_000),
  // Object storage (MinIO in dev, S3-compatible in prod) for encrypted file blobs.
  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('securechat-attachments'),
  S3_ACCESS_KEY: z.string().default('minioadmin'),
  S3_SECRET_KEY: z.string().default('minioadmin'),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // Fail fast with a readable message rather than crashing deep in a handler.
  console.error('❌ Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export const isProd = config.NODE_ENV === 'production';

/**
 * Production hardening: the Zod schema above only validates SHAPE. In production we
 * additionally reject known-insecure DEFAULTS and placeholders so a misconfigured
 * deploy can never boot with forgeable JWT secrets or `minioadmin` storage creds.
 * Fail fast (exit 1) rather than serve traffic with a known-weak secret.
 */
if (isProd) {
  const problems: string[] = [];
  const looksPlaceholder = (v: string) => /replace[-_ ]?me|changeme|example|secret-min-32-bytes/i.test(v);

  if (looksPlaceholder(config.JWT_ACCESS_SECRET) || config.JWT_ACCESS_SECRET.length < 32)
    problems.push('JWT_ACCESS_SECRET is a placeholder or shorter than 32 bytes');
  if (looksPlaceholder(config.JWT_REFRESH_SECRET) || config.JWT_REFRESH_SECRET.length < 32)
    problems.push('JWT_REFRESH_SECRET is a placeholder or shorter than 32 bytes');
  if (config.JWT_ACCESS_SECRET === config.JWT_REFRESH_SECRET)
    problems.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ');
  if (config.S3_ACCESS_KEY === 'minioadmin' || config.S3_SECRET_KEY === 'minioadmin')
    problems.push('S3 credentials are the insecure default (minioadmin)');
  if (/(^|:)(securechat_dev_password|password|postgres)(@|$)/.test(config.DATABASE_URL))
    problems.push('DATABASE_URL uses a weak/default password');

  if (problems.length > 0) {
    console.error('❌ Refusing to start in production with insecure configuration:');
    for (const p of problems) console.error(`   • ${p}`);
    console.error('   Set strong, unique secrets (e.g. `openssl rand -base64 48`).');
    process.exit(1);
  }
}
