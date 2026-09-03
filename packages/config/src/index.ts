import { z } from 'zod';

const schema = z.object({
  ENVIRONMENT: z.enum(['local', 'preview', 'staging', 'production']),
  RELEASE_VERSION: z.string().min(1),
  ACCESS_TEAM_DOMAIN: z
    .string()
    .url()
    .refine((value) => value.startsWith('https://')),
  ACCESS_AUD: z.string().min(16),
  APP_ORIGIN: z
    .string()
    .url()
    .refine((value) => value.startsWith('https://') || value.startsWith('http://localhost')),
  OWNER_BOOTSTRAP_ENABLED: z.enum(['true', 'false']).transform((value) => value === 'true'),
  BOOTSTRAP_OWNER_EMAIL: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().email())
    .transform((value) => value.toLowerCase()),
  TOKEN_ENCRYPTION_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_PROVIDER_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  AI_PROVIDER_CONNECTIVITY_DIAGNOSTIC_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  OPENAI_API_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
});

export type RuntimeConfig = z.output<typeof schema>;
export function parseConfig(value: unknown): RuntimeConfig {
  return schema.parse(value);
}
