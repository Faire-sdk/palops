import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { api, createTestApp, sessionCookie } from './helpers.js';

const EMERGENCY = 'break-glass-password-1234';

describe('emergency sign-in', () => {
  it('signs in as the owner, even with password sign-in off', async () => {
    const { app, services } = await createTestApp({ PANEL_EMERGENCY_PASSWORD: EMERGENCY, AUTH_PASSWORD_LOGIN: 'false', DEV_DISCORD_LOGIN: 'true', NODE_ENV: 'development' });
    await services.users.create({ username: 'admin-user', password: 'correct-horse-battery', role: 'admin' });
    const owner = await services.users.create({ username: 'the-owner', password: 'correct-horse-battery', role: 'owner' });

    const options = await api(app, { method: 'GET', url: '/api/v1/auth/options' });
    expect(options.json().providers).toMatchObject({ password: false, emergency: true });

    const res = await api(app, { method: 'POST', url: '/api/v1/auth/emergency', payload: { password: EMERGENCY } });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.id).toBe(owner.id);

    const me = await api(app, { method: 'GET', url: '/api/v1/auth/me', cookie: sessionCookie(res) });
    expect(me.json().user.username).toBe('the-owner');
    const audit = services.db.prepare("SELECT details FROM audit_log WHERE action = 'login' ORDER BY id DESC LIMIT 1").get() as { details: string };
    expect(JSON.parse(audit.details)).toEqual({ method: 'emergency' });
  });

  it('refuses a wrong password, and stops after a few tries', async () => {
    const { app, services } = await createTestApp({ PANEL_EMERGENCY_PASSWORD: EMERGENCY });
    await services.users.create({ username: 'the-owner', password: 'correct-horse-battery', role: 'owner' });

    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      codes.push((await api(app, { method: 'POST', url: '/api/v1/auth/emergency', payload: { password: 'wrong-guess-123456' } })).statusCode);
    }
    expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(codes[5]).toBe(429);
    // Even the right password is refused from that address until the window passes.
    expect((await api(app, { method: 'POST', url: '/api/v1/auth/emergency', payload: { password: EMERGENCY } })).statusCode).toBe(429);
  });

  it('is off unless configured, and needs a long password', async () => {
    const { app } = await createTestApp();
    expect((await api(app, { method: 'POST', url: '/api/v1/auth/emergency', payload: { password: EMERGENCY } })).statusCode).toBe(403);
    expect((await api(app, { method: 'GET', url: '/api/v1/auth/options' })).json().providers.emergency).toBe(false);
    expect(() => loadConfig({ NODE_ENV: 'test', DATABASE_PATH: ':memory:', PANEL_EMERGENCY_PASSWORD: 'short' })).toThrow(/16 characters/);
  });
});
