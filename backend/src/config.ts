import 'dotenv/config';
import { z } from 'zod';

export function durationMilliseconds(value: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(value);
  if (!match) throw new Error('Token duration must use a positive number followed by s, m, h, or d.');
  const factors: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  const duration = Number(match[1]) * factors[match[2]];
  if (duration < 60000 || duration > 365 * 86400000)
    throw new Error('Refresh token duration must be between one minute and 365 days.');
  return duration;
}
const tokenDuration = z.string().refine((value) => {
  try {
    durationMilliseconds(value);
    return true;
  } catch {
    return false;
  }
}, 'Use a duration between 1m and 365d, for example 7d');

const env = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(5000),
    HOST: z.string().default('127.0.0.1'),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    DATABASE_URL: z.string().min(1),
    JWT_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    JWT_EXPIRES_IN: z.string().default('15m'),
    REFRESH_TOKEN_EXPIRES_IN: tokenDuration.default('1d'),
    REMEMBER_TOKEN_EXPIRES_IN: tokenDuration.default('30d'),
    APP_URL: z.string().url().optional(),
    CORS_ORIGIN: z.string().default('http://127.0.0.1:5173'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().default(587),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_FROM: z.string().default('Asset Management <noreply@example.com>'),
    LOG_LEVEL: z.string().default('info'),
  })
  .safeParse(process.env);
if (!env.success)
  throw new Error(
    `Invalid server configuration: ${env.error.issues.map((i) => i.path.join('.')).join(', ')}`,
  );
export const config = env.data;
if (
  ['production', 'staging'].includes(config.NODE_ENV) &&
  !config.CORS_ORIGIN.split(',').every((v) => v.trim().startsWith('https://'))
) {
  throw new Error('Production CORS_ORIGIN must use HTTPS.');
}
if (
  ['production', 'staging'].includes(config.NODE_ENV) &&
  config.APP_URL &&
  !config.APP_URL.startsWith('https://')
)
  throw new Error('Production APP_URL must use HTTPS.');
