import { beforeEach, describe, expect, it } from 'vitest';
import { api, createTestApp, loginAs, PASSWORD, sessionCookie } from './helpers.js';

let ctx: Awaited<ReturnType<typeof createTestApp>>;
beforeEach(async () => {
  ctx = await createTestApp();
});

describe('first-run setup', () => {
  it('reports setup as required and rejects a wrong token', async () => {
    const status = await api(ctx.app, { method: 'GET', url: '/api/v1/auth/options' });
    expect(status.json()).toEqual({ setupRequired: true, providers: { discord: false, password: true } });

    const res = await api(ctx.app, {
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: { setupToken: 'wrong', username: 'owner', password: PASSWORD },
    });
    expect(res.statusCode).toBe(403);
    expect(ctx.services.users.count()).toBe(0);
  });

  it('asks for the setup token when it is left blank', async () => {
    for (const setupToken of [undefined, '', '  ']) {
      const res = await api(ctx.app, {
        method: 'POST',
        url: '/api/v1/auth/setup',
        payload: { setupToken, username: 'owner', password: PASSWORD },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatchObject({ code: 'setup_token_missing', message: 'Enter the setup token printed in the server log' });
    }
    expect(ctx.services.users.count()).toBe(0);
  });

  it('creates the owner once and signs them in', async () => {
    const res = await api(ctx.app, {
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: { setupToken: 'test-setup-token-123', username: 'owner', password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.role).toBe('owner');
    const me = await api(ctx.app, { method: 'GET', url: '/api/v1/auth/me', cookie: sessionCookie(res) });
    expect(me.json().user.username).toBe('owner');

    const again = await api(ctx.app, {
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: { setupToken: 'test-setup-token-123', username: 'second', password: PASSWORD },
    });
    expect(again.statusCode).toBe(403);
  });
});

describe('login and sessions', () => {
  beforeEach(async () => {
    await ctx.services.users.create({ username: 'alice', password: PASSWORD, role: 'admin' });
  });

  it('rejects invalid credentials with the same message for unknown users', async () => {
    const wrong = await api(ctx.app, { method: 'POST', url: '/api/v1/auth/login', payload: { username: 'alice', password: 'nope-nope-nope' } });
    const unknown = await api(ctx.app, { method: 'POST', url: '/api/v1/auth/login', payload: { username: 'bob', password: 'nope-nope-nope' } });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json().error.message).toBe(unknown.json().error.message);
  });

  it('sets an HttpOnly, SameSite=Strict cookie and never stores the raw token', async () => {
    const res = await api(ctx.app, { method: 'POST', url: '/api/v1/auth/login', payload: { username: 'alice', password: PASSWORD } });
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((c) => c.name === 'palops_session')!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe('Strict');
    const stored = ctx.services.db.prepare('SELECT id FROM sessions').all() as { id: string }[];
    expect(stored.map((s) => s.id)).not.toContain(cookie.value);
    expect(res.json().permissions).toContain('server.control');
  });

  it('logout invalidates the session', async () => {
    const cookie = await loginAs(ctx.app, ctx.services, 'viewer');
    expect((await api(ctx.app, { method: 'GET', url: '/api/v1/auth/me', cookie })).statusCode).toBe(200);
    await api(ctx.app, { method: 'POST', url: '/api/v1/auth/logout', cookie });
    expect((await api(ctx.app, { method: 'GET', url: '/api/v1/auth/me', cookie })).statusCode).toBe(401);
  });

  it('expires sessions after the idle timeout', async () => {
    const cookie = await loginAs(ctx.app, ctx.services, 'viewer');
    ctx.services.db.prepare('UPDATE sessions SET expires_at = ?').run(new Date(Date.now() - 1000).toISOString());
    expect((await api(ctx.app, { method: 'GET', url: '/api/v1/auth/me', cookie })).statusCode).toBe(401);
  });

  it('disabling a user ends their sessions and blocks login', async () => {
    const cookie = await loginAs(ctx.app, ctx.services, 'viewer', 'vic');
    const vic = ctx.services.users.findForLogin('vic')!;
    ctx.services.users.update(vic.id, { disabled: true });
    expect((await api(ctx.app, { method: 'GET', url: '/api/v1/auth/me', cookie })).statusCode).toBe(401);
    const res = await api(ctx.app, { method: 'POST', url: '/api/v1/auth/login', payload: { username: 'vic', password: PASSWORD } });
    expect(res.statusCode).toBe(401);
  });

  it('rate limits repeated failures for a username', async () => {
    for (let i = 0; i < 5; i++) {
      await api(ctx.app, { method: 'POST', url: '/api/v1/auth/login', payload: { username: 'alice', password: 'bad-password-x' } });
    }
    const res = await api(ctx.app, { method: 'POST', url: '/api/v1/auth/login', payload: { username: 'alice', password: PASSWORD } });
    expect(res.statusCode).toBe(429);
  });

  it('records login attempts in the audit log', async () => {
    await api(ctx.app, { method: 'POST', url: '/api/v1/auth/login', payload: { username: 'alice', password: 'bad-password-x' } });
    await api(ctx.app, { method: 'POST', url: '/api/v1/auth/login', payload: { username: 'alice', password: PASSWORD } });
    const actions = ctx.services.audit.list({ limit: 10, offset: 0 }).entries.map((e) => e.action);
    expect(actions).toEqual(['login', 'login_failed']);
  });
});

describe('password change and reset', () => {
  it('requires the current password and signs out other sessions', async () => {
    const first = await loginAs(ctx.app, ctx.services, 'admin', 'amy');
    const second = await loginAs(ctx.app, ctx.services, 'admin', 'amy');

    const bad = await api(ctx.app, {
      method: 'POST',
      url: '/api/v1/auth/password',
      cookie: first,
      payload: { currentPassword: 'wrong-password', newPassword: 'another-good-password' },
    });
    expect(bad.statusCode).toBe(400);

    const weak = await api(ctx.app, {
      method: 'POST',
      url: '/api/v1/auth/password',
      cookie: first,
      payload: { currentPassword: PASSWORD, newPassword: 'short' },
    });
    expect(weak.statusCode).toBe(400);

    const ok = await api(ctx.app, {
      method: 'POST',
      url: '/api/v1/auth/password',
      cookie: first,
      payload: { currentPassword: PASSWORD, newPassword: 'another-good-password' },
    });
    expect(ok.statusCode).toBe(200);
    expect((await api(ctx.app, { method: 'GET', url: '/api/v1/auth/me', cookie: first })).statusCode).toBe(200);
    expect((await api(ctx.app, { method: 'GET', url: '/api/v1/auth/me', cookie: second })).statusCode).toBe(401);
  });

  it('lets an owner issue a one-time reset token', async () => {
    const owner = await loginAs(ctx.app, ctx.services, 'owner');
    const target = await ctx.services.users.create({ username: 'forgetful', password: PASSWORD, role: 'moderator' });
    const issued = await api(ctx.app, { method: 'POST', url: `/api/v1/users/${target.id}/password-reset`, cookie: owner });
    const { token } = issued.json();

    const reset = () =>
      api(ctx.app, { method: 'POST', url: '/api/v1/auth/reset', payload: { token, newPassword: 'brand-new-password' } });
    expect((await reset()).statusCode).toBe(200);
    expect((await reset()).statusCode).toBe(400);

    const login = await api(ctx.app, {
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'forgetful', password: 'brand-new-password' },
    });
    expect(login.statusCode).toBe(200);
  });
});
