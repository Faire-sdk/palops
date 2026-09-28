import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { api, createTestApp } from './helpers.js';

const DEV = { NODE_ENV: 'development', LOG_LEVEL: 'silent', DEV_DISCORD_LOGIN: 'true' };

describe('local development Discord stand-in', () => {
  it('refuses to run outside development', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', PANEL_SECRET: 'x'.repeat(32), DEV_DISCORD_LOGIN: 'true' })).toThrow(/development/);
    expect(() => loadConfig({ NODE_ENV: 'test', DATABASE_PATH: ':memory:', DEV_MOCK_SERVER: 'true' })).toThrow(/development/);
  });

  it('is not reachable unless enabled', async () => {
    const { app } = await createTestApp();
    expect((await api(app, { method: 'GET', url: '/api/v1/auth/dev-discord?state=x' })).statusCode).toBe(404);
  });

  it('runs setup and player sign-in through the real callback', async () => {
    const { app, services } = await createTestApp(DEV);
    const signIn = async (intent: string, id: string, username: string, extra: Record<string, string> = {}) => {
      const start = await api(app, { method: 'POST', url: '/api/v1/auth/discord/authorize', payload: { intent, ...extra } });
      const { url } = start.json();
      expect(url.startsWith('/api/v1/auth/dev-discord?state=')).toBe(true);
      const state = new URL(url, 'http://x').searchParams.get('state')!;
      const cookie = `palops_oauth_state=${state}`;
      const page = await app.inject({ method: 'GET', url, headers: { cookie } });
      expect(page.headers['content-type']).toContain('text/html');
      const approve = await app.inject({
        method: 'GET',
        url: `/api/v1/auth/dev-discord/approve?${new URLSearchParams({ state, id, username })}`,
      });
      return app.inject({ method: 'GET', url: approve.headers.location as string, headers: { cookie } });
    };

    const owner = await signIn('setup', '100000000000000001', 'local_owner', { setupToken: 'test-setup-token-123' });
    expect(owner.headers.location).toBe('/panel');
    expect(services.users.findByDiscordId('100000000000000001')).toMatchObject({ role: 'owner', username: 'local_owner' });

    const player = await signIn('player', '100000000000000003', 'lambfan');
    expect(player.headers.location).toBe('/account');
    expect(services.siteAccounts.getByDiscordId('100000000000000003')).toBeDefined();

    const bad = await signIn('player', 'not-an-id', 'x');
    expect(bad.headers.location).toBe('/account?auth_error=discord_error');
  });
});
