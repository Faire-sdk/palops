import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  DATABASE_PATH: z.string().default('./data/panel.db'),
  PANEL_SECRET: z.string().min(32, 'PANEL_SECRET must be at least 32 characters').optional(),
  PANEL_SETUP_TOKEN: z.string().min(16).optional(),
  SESSION_IDLE_HOURS: z.coerce.number().positive().default(12),
  SESSION_MAX_DAYS: z.coerce.number().positive().default(7),
  COOKIE_SECURE: z.enum(['auto', 'true', 'false']).default('auto'),
  TRUST_PROXY: booleanString.default(false),
  WEB_DIST_PATH: z.string().default('../web/dist'),
  DISCORD_CLIENT_ID: z.string().regex(/^\d{15,25}$/, 'must be the numeric application ID').optional(),
  DISCORD_CLIENT_SECRET: z.string().min(1).optional(),
  DISCORD_REDIRECT_URI: z.url().optional(),
  AUTH_PASSWORD_LOGIN: booleanString.optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export interface Config {
  env: 'development' | 'production' | 'test';
  host: string;
  port: number;
  databasePath: string;
  /** Used to derive encryption keys for stored credentials. Never sent to clients. */
  secret: string;
  setupToken?: string;
  sessionIdleMs: number;
  sessionMaxMs: number;
  cookieSecure: boolean;
  trustProxy: boolean;
  webDistPath: string;
  logLevel: string;
  /** Discord OAuth2 settings; null when Discord sign-in is not configured. */
  discord: { clientId: string; clientSecret: string; redirectUri: string } | null;
  /** Whether username/password sign-in is offered. */
  passwordLogin: boolean;
}

function resolveDiscord(env: z.infer<typeof envSchema>): Config['discord'] {
  const values = [env.DISCORD_CLIENT_ID, env.DISCORD_CLIENT_SECRET, env.DISCORD_REDIRECT_URI];
  if (values.every((v) => !v)) return null;
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET || !env.DISCORD_REDIRECT_URI) {
    throw new Error('Discord sign-in needs DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET and DISCORD_REDIRECT_URI together.');
  }
  return { clientId: env.DISCORD_CLIENT_ID, clientSecret: env.DISCORD_CLIENT_SECRET, redirectUri: env.DISCORD_REDIRECT_URI };
}

/**
 * In development the secret is generated once and kept next to the database so
 * a fresh checkout works without setup. Production must provide PANEL_SECRET.
 */
function resolveSecret(env: z.infer<typeof envSchema>): string {
  if (env.PANEL_SECRET) return env.PANEL_SECRET;
  if (env.NODE_ENV === 'production') {
    throw new Error('PANEL_SECRET is required in production (at least 32 random characters).');
  }
  if (env.DATABASE_PATH === ':memory:') return randomBytes(32).toString('hex');
  const file = join(dirname(resolve(env.DATABASE_PATH)), '.panel-secret');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  mkdirSync(dirname(file), { recursive: true });
  const secret = randomBytes(32).toString('hex');
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  const env = parsed.data;
  const discord = resolveDiscord(env);
  // Discord is the primary sign-in; passwords are on by default only when Discord isn't set up.
  const passwordLogin = env.AUTH_PASSWORD_LOGIN ?? !discord;
  if (!discord && !passwordLogin) {
    throw new Error('AUTH_PASSWORD_LOGIN=false requires Discord sign-in to be configured, or nobody could sign in.');
  }
  return {
    env: env.NODE_ENV,
    host: env.HOST,
    port: env.PORT,
    databasePath: env.DATABASE_PATH,
    secret: resolveSecret(env),
    setupToken: env.PANEL_SETUP_TOKEN,
    sessionIdleMs: env.SESSION_IDLE_HOURS * 60 * 60 * 1000,
    sessionMaxMs: env.SESSION_MAX_DAYS * 24 * 60 * 60 * 1000,
    cookieSecure: env.COOKIE_SECURE === 'auto' ? env.NODE_ENV === 'production' : env.COOKIE_SECURE === 'true',
    trustProxy: env.TRUST_PROXY,
    webDistPath: env.WEB_DIST_PATH,
    logLevel: env.LOG_LEVEL,
    discord,
    passwordLogin,
  };
}
