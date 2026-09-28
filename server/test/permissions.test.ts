import { beforeEach, describe, expect, it } from 'vitest';
import { hasPermission } from '../src/services/authentication/permissions.js';
import { api, createTestApp, loginAs, PASSWORD } from './helpers.js';

let ctx: Awaited<ReturnType<typeof createTestApp>>;
beforeEach(async () => {
  ctx = await createTestApp();
});

describe('role permissions', () => {
  it('matches the roadmap roles', () => {
    expect(hasPermission('owner', 'users.manage')).toBe(true);
    expect(hasPermission('admin', 'users.manage')).toBe(false);
    expect(hasPermission('admin', 'console.execute')).toBe(true);
    expect(hasPermission('moderator', 'players.kick')).toBe(true);
    expect(hasPermission('moderator', 'players.ban')).toBe(false);
    expect(hasPermission('moderator', 'console.execute')).toBe(false);
    expect(hasPermission('viewer', 'server.view')).toBe(true);
    expect(hasPermission('viewer', 'players.kick')).toBe(false);
  });
});

describe('API enforcement', () => {
  it('rejects unauthenticated requests', async () => {
    for (const url of ['/api/v1/server/status', '/api/v1/players', '/api/v1/users', '/api/v1/logs/audit']) {
      expect((await api(ctx.app, { method: 'GET', url })).statusCode).toBe(401);
    }
  });

  it('lets a viewer read status but not change anything', async () => {
    const cookie = await loginAs(ctx.app, ctx.services, 'viewer');
    expect((await api(ctx.app, { method: 'GET', url: '/api/v1/server/status', cookie })).statusCode).toBe(200);
    const forbidden = [
      { method: 'POST' as const, url: '/api/v1/server/announce', payload: { message: 'hi' } },
      { method: 'GET' as const, url: '/api/v1/server/connection' },
      { method: 'GET' as const, url: '/api/v1/users' },
      { method: 'GET' as const, url: '/api/v1/logs/audit' },
    ];
    for (const req of forbidden) expect((await api(ctx.app, { ...req, cookie })).statusCode).toBe(403);
  });

  it('stops an admin from escalating to owner', async () => {
    const cookie = await loginAs(ctx.app, ctx.services, 'admin');
    const res = await api(ctx.app, {
      method: 'POST',
      url: '/api/v1/users',
      cookie,
      payload: { username: 'sneaky', password: PASSWORD, role: 'owner' },
    });
    expect(res.statusCode).toBe(403);
    const me = ctx.services.users.findForLogin('admin-user')!;
    const patch = await api(ctx.app, { method: 'PATCH', url: `/api/v1/users/${me.id}`, cookie, payload: { role: 'owner' } });
    expect(patch.statusCode).toBe(403);
  });

  it('refuses to remove the last active owner', async () => {
    const cookie = await loginAs(ctx.app, ctx.services, 'owner');
    const me = ctx.services.users.findForLogin('owner-user')!;
    const res = await api(ctx.app, { method: 'PATCH', url: `/api/v1/users/${me.id}`, cookie, payload: { role: 'admin' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('last_owner');
  });

  it('requires the CSRF header on state-changing requests', async () => {
    const cookie = await loginAs(ctx.app, ctx.services, 'owner');
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/server/announce',
      headers: { cookie },
      payload: { message: 'hi' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects cross-origin state-changing requests', async () => {
    const cookie = await loginAs(ctx.app, ctx.services, 'owner');
    const res = await api(ctx.app, {
      method: 'POST',
      url: '/api/v1/auth/logout',
      cookie,
      headers: { origin: 'https://evil.example', host: 'panel.example' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('validates input', async () => {
    const cookie = await loginAs(ctx.app, ctx.services, 'owner');
    const res = await api(ctx.app, {
      method: 'POST',
      url: '/api/v1/users',
      cookie,
      payload: { username: 'x; DROP TABLE users', password: PASSWORD, role: 'viewer' },
    });
    expect(res.statusCode).toBe(400);
    const badRole = await api(ctx.app, {
      method: 'POST',
      url: '/api/v1/users',
      cookie,
      payload: { username: 'valid_name', password: PASSWORD, role: 'superuser' },
    });
    expect(badRole.statusCode).toBe(400);
  });
});
