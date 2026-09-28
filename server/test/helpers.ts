import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/database/db.js';
import { createServices, type Services } from '../src/services/index.js';
import type { Role } from '../src/services/authentication/permissions.js';

export const PASSWORD = 'correct-horse-battery';

export async function createTestApp(): Promise<{ app: FastifyInstance; services: Services }> {
  const config = loadConfig({ NODE_ENV: 'test', DATABASE_PATH: ':memory:', PANEL_SETUP_TOKEN: 'test-setup-token-123' });
  const services = createServices(config, openDatabase(config.databasePath));
  const app = await buildApp(services);
  return { app, services };
}

/** Sends a request the way the web client does (JSON + CSRF header). */
export function api(app: FastifyInstance, opts: InjectOptions & { cookie?: string }) {
  const { cookie, headers, ...rest } = opts;
  return app.inject({
    ...rest,
    headers: { 'x-palops-csrf': '1', ...(cookie ? { cookie } : {}), ...headers },
  });
}

export function sessionCookie(res: { cookies: Array<{ name: string; value: string }> }): string {
  const c = res.cookies.find((c) => c.name === 'palops_session');
  if (!c) throw new Error('No session cookie set');
  return `palops_session=${c.value}`;
}

export async function loginAs(app: FastifyInstance, services: Services, role: Role, username = `${role}-user`) {
  if (!services.users.findForLogin(username)) await services.users.create(username, PASSWORD, role);
  const res = await api(app, { method: 'POST', url: '/api/v1/auth/login', payload: { username, password: PASSWORD } });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.body}`);
  return sessionCookie(res);
}
