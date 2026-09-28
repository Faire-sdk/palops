import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, createTestApp, loginAs } from './helpers.js';

let ctx: Awaited<ReturnType<typeof createTestApp>>;
const ANUBIS = 'steam_76561190000000002';
const LAMBALL = 'steam_76561190000000001';
const CATTIVA = 'epic_0f3a9c2b1d';

beforeEach(async () => {
  ctx = await createTestApp();
  ctx.services.servers.savePrimary({ name: 'Dev', adapter: 'mock', host: '', port: 8212, username: 'admin' });
  await ctx.services.players.refreshOnline();
});

const post = (cookie: string, url: string, payload: Record<string, unknown> = {}) => api(ctx.app, { method: 'POST', url, cookie, payload });
const get = (cookie: string, url: string) => api(ctx.app, { method: 'GET', url, cookie });

describe('player moderation', () => {
  it('kicks a player, records it and shows it in their history', async () => {
    const mod = await loginAs(ctx.app, ctx.services, 'moderator');
    const res = await post(mod, `/api/v1/players/${ANUBIS}/kick`, { reason: 'AFK in the boss arena' });
    expect(res.statusCode).toBe(200);
    expect(res.json().record).toMatchObject({ action: 'kick', playerName: 'Anubis', reason: 'AFK in the boss arena', actorUsername: 'moderator-user' });

    const online = await get(mod, '/api/v1/players');
    expect(online.json().players.map((p: { userId: string }) => p.userId)).not.toContain(ANUBIS);

    const profile = await get(mod, `/api/v1/players/${ANUBIS}`);
    expect(profile.json()).toMatchObject({ player: { name: 'Anubis', level: 47 }, banned: false, history: [{ action: 'kick' }] });

    const audit = ctx.services.audit.list({ category: 'players', limit: 5, offset: 0 });
    expect(audit.entries[0]).toMatchObject({ action: 'kick', target: `Anubis (${ANUBIS})` });
  });

  it('only lets admins ban, and tracks bans until an unban', async () => {
    const mod = await loginAs(ctx.app, ctx.services, 'moderator');
    expect((await post(mod, `/api/v1/players/${ANUBIS}/ban`, { reason: 'x' })).statusCode).toBe(403);

    const admin = await loginAs(ctx.app, ctx.services, 'admin');
    expect((await post(admin, `/api/v1/players/${ANUBIS}/ban`, { reason: 'Griefing bases' })).statusCode).toBe(200);
    expect((await get(admin, '/api/v1/players/bans')).json().bans).toMatchObject([{ playerUserId: ANUBIS, reason: 'Griefing bases' }]);
    const known = (await get(admin, '/api/v1/players/known')).json();
    expect(known.total).toBe(3);
    expect(known.players.find((p: { userId: string }) => p.userId === ANUBIS)).toMatchObject({ banned: true, online: false });

    expect((await post(admin, `/api/v1/players/${ANUBIS}/unban`)).statusCode).toBe(200);
    expect((await get(admin, '/api/v1/players/bans')).json().bans).toEqual([]);
    expect((await get(admin, `/api/v1/players/${ANUBIS}`)).json().history.map((h: { action: string }) => h.action)).toEqual(['unban', 'ban']);
  });

  it('can ban a platform id the panel has never seen', async () => {
    const admin = await loginAs(ctx.app, ctx.services, 'admin');
    const res = await post(admin, '/api/v1/players/steam_76561199999999999/ban', { reason: 'Known cheater' });
    expect(res.json().record).toMatchObject({ playerName: null, playerUserId: 'steam_76561199999999999' });
  });

  it('keeps staff notes, and viewers can read but not write them', async () => {
    const mod = await loginAs(ctx.app, ctx.services, 'moderator');
    expect((await post(mod, `/api/v1/players/${ANUBIS}/notes`, { text: 'Warned about spawn camping' })).statusCode).toBe(200);
    expect((await post(mod, `/api/v1/players/${ANUBIS}/notes`, { text: '  ' })).statusCode).toBe(400);

    const viewer = await loginAs(ctx.app, ctx.services, 'viewer');
    expect((await post(viewer, `/api/v1/players/${ANUBIS}/notes`, { text: 'hi' })).statusCode).toBe(403);
    expect((await get(viewer, `/api/v1/players/${ANUBIS}`)).json().history).toMatchObject([{ action: 'note', reason: 'Warned about spawn camping' }]);
  });

  it('searches known players by name, id or guild', async () => {
    const viewer = await loginAs(ctx.app, ctx.services, 'viewer');
    const byGuild = (await get(viewer, '/api/v1/players/known?search=desert')).json();
    expect(byGuild.players.map((p: { name: string }) => p.name)).toEqual(['Anubis']);
    expect((await get(viewer, '/api/v1/players/known?search=100%25')).json().total).toBe(0);
  });

  it('rejects malformed player ids', async () => {
    const admin = await loginAs(ctx.app, ctx.services, 'admin');
    expect((await post(admin, '/api/v1/players/bad%20id/kick')).statusCode).toBe(400);
  });
});

describe('server controls and configuration', () => {
  it('saves, shuts down and force stops for admins only', async () => {
    const mod = await loginAs(ctx.app, ctx.services, 'moderator');
    expect((await post(mod, '/api/v1/server/save')).statusCode).toBe(403);

    const admin = await loginAs(ctx.app, ctx.services, 'admin');
    expect((await post(admin, '/api/v1/server/save')).statusCode).toBe(200);
    expect((await post(admin, '/api/v1/server/shutdown', { waitSeconds: 0 })).statusCode).toBe(400);
    expect((await post(admin, '/api/v1/server/shutdown', { waitSeconds: 60, message: 'Restarting for the update' })).statusCode).toBe(200);
    expect((await get(admin, '/api/v1/server/status')).json().state).toBe('offline');

    ctx.services.palworld.mock.start();
    expect((await post(admin, '/api/v1/server/stop')).statusCode).toBe(200);
    const actions = ctx.services.audit.list({ category: 'server', limit: 10, offset: 0 }).entries.map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['world_saved', 'shutdown', 'force_stop']));
  });

  it('shows the live server settings to admins', async () => {
    const viewer = await loginAs(ctx.app, ctx.services, 'viewer');
    expect((await get(viewer, '/api/v1/config')).statusCode).toBe(403);
    const admin = await loginAs(ctx.app, ctx.services, 'admin');
    const res = await get(admin, '/api/v1/config');
    expect(res.statusCode).toBe(200);
    expect(res.json().settings).toMatchObject({ ServerName: 'Mock Palworld Server', RESTAPIPort: 8212, bIsPvP: false });
  });
});
