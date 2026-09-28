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

describe('player addresses and IP bans', () => {
  const del = (cookie: string, url: string) => api(ctx.app, { method: 'DELETE', url, cookie });

  it('shows addresses to staff only, in the online list and on profiles', async () => {
    const viewer = await loginAs(ctx.app, ctx.services, 'viewer');
    const online = (await get(viewer, '/api/v1/players')).json().players;
    expect(online.every((p: { ip: unknown; location: unknown }) => p.ip === null && p.location === null)).toBe(true);
    expect((await get(viewer, `/api/v1/players/${ANUBIS}`)).json()).toMatchObject({ ips: [], live: null });

    const mod = await loginAs(ctx.app, ctx.services, 'moderator');
    expect((await get(mod, '/api/v1/players')).json().players.find((p: { userId: string }) => p.userId === ANUBIS).ip).toBe('198.51.100.23');
    const profile = (await get(mod, `/api/v1/players/${LAMBALL}`)).json();
    // Lamball Enjoyer and CattivaFan connect from the same address.
    expect(profile.ips).toMatchObject([{ ip: '203.0.113.7', banned: false, sharedWith: [{ userId: CATTIVA, name: 'CattivaFan' }] }]);
    expect(profile.live).toMatchObject({ ip: '203.0.113.7', ping: expect.any(Number) });
    expect((await get(viewer, '/api/v1/players/bans')).json().ipBans).toEqual([]);
  });

  it('bans the last address with a player and lifts it when they are unbanned', async () => {
    const admin = await loginAs(ctx.app, ctx.services, 'admin');
    const res = (await post(admin, `/api/v1/players/${ANUBIS}/ban`, { reason: 'Griefing', banIp: true })).json();
    expect(res.ipBan).toMatchObject({ ip: '198.51.100.23', sourceUserId: ANUBIS, sourceName: 'Anubis', reason: 'Griefing' });
    expect((await get(admin, '/api/v1/players/bans')).json().ipBans).toHaveLength(1);
    expect((await get(admin, `/api/v1/players/${ANUBIS}`)).json().ips[0]).toMatchObject({ banned: true });

    await post(admin, `/api/v1/players/${ANUBIS}/unban`);
    expect((await get(admin, '/api/v1/players/bans')).json().ipBans).toEqual([]);
    const actions = ctx.services.audit.list({ category: 'players', limit: 10, offset: 0 }).entries.map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['ip_ban', 'ip_unban']));
  });

  it('bans every account on a banned address, now and when they connect later', async () => {
    const admin = await loginAs(ctx.app, ctx.services, 'admin');
    expect((await post(admin, '/api/v1/players/ip-bans', { ip: '203.0.113.7', reason: 'Ban evasion' })).statusCode).toBe(200);
    // Both online players on that address are banned and kicked straight away.
    await vi.waitFor(() => {
      expect(ctx.services.moderation.isBanned(LAMBALL)).toBe(true);
      expect(ctx.services.moderation.isBanned(CATTIVA)).toBe(true);
    });
    expect(ctx.services.moderation.isBanned(ANUBIS)).toBe(false);
    expect((await get(admin, '/api/v1/players/bans')).json().bans[0]).toMatchObject({ actorUsername: 'PalOps (IP ban)', reason: expect.stringContaining('Banned address: Ban evasion') });

    // A brand new account from the same address is caught at the next snapshot.
    ctx.services.players.recordIps(ctx.services.servers.getPrimary()!.id, [{ userId: 'steam_new', name: 'Fresh Account', ip: '::ffff:203.0.113.7' }]);
    await vi.waitFor(() => expect(ctx.services.moderation.isBanned('steam_new')).toBe(true));

    const id = (await get(admin, '/api/v1/players/bans')).json().ipBans[0].id;
    expect((await del(admin, `/api/v1/players/ip-bans/${id}`)).statusCode).toBe(200);
    expect((await get(admin, '/api/v1/players/bans')).json().ipBans).toEqual([]);
  });

  it('refuses private addresses, bad input and non-admins', async () => {
    const admin = await loginAs(ctx.app, ctx.services, 'admin');
    for (const ip of ['127.0.0.1', '192.168.1.20', '10.0.0.5', '::1', 'not-an-ip']) {
      expect((await post(admin, '/api/v1/players/ip-bans', { ip })).statusCode).toBe(400);
    }
    const mod = await loginAs(ctx.app, ctx.services, 'moderator');
    expect((await post(mod, '/api/v1/players/ip-bans', { ip: '203.0.113.9' })).statusCode).toBe(403);
    expect((await del(mod, '/api/v1/players/ip-bans/1')).statusCode).toBe(403);
    expect((await del(admin, '/api/v1/players/ip-bans/999')).statusCode).toBe(404);
  });

  it('bans only the account when the address is a shared range', async () => {
    const admin = await loginAs(ctx.app, ctx.services, 'admin');
    ctx.services.players.recordIps(ctx.services.servers.getPrimary()!.id, [{ userId: 'steam_local', name: 'Lan Player', ip: '192.168.1.5' }]);
    const res = (await post(admin, '/api/v1/players/steam_local/ban', { banIp: true })).json();
    expect(res.ipBan).toBeNull();
    expect(res.ipSkipped).toContain('private');
    expect(res.record).toMatchObject({ action: 'ban' });
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
