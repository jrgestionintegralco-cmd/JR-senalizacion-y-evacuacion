import 'dotenv/config';
import { z } from 'zod';

const booleanValue = z.string().default('false').transform((value) => value === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(72).default(8),
  COOKIE_SECURE: booleanValue,
  S3_ENDPOINT: z.string().url(),
  S3_PUBLIC_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().min(3),
  S3_ACCESS_KEY: z.string().min(3),
  S3_SECRET_KEY: z.string().min(8),
  S3_FORCE_PATH_STYLE: booleanValue,
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(26_214_400)
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(`Configuración inválida: ${z.prettifyError(result.error)}`);
  }
  return { ...result.data, S3_PUBLIC_ENDPOINT: result.data.S3_PUBLIC_ENDPOINT ?? result.data.S3_ENDPOINT };
}
