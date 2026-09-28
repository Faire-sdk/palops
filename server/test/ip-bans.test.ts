import { beforeEach, describe, expect, it } from 'vitest';
import { parseIpRule } from '../src/services/players/moderation.js';
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
const online = async () => (await ctx.services.palworld.getPlayers()).map((p) => p.userId);

describe('player addresses', () => {
  it('shows addresses and linked players to moderators, never to viewers', async () => {
    const mod = await loginAs(ctx.app, ctx.services, 'moderator');
    const profile = (await get(mod, `/api/v1/players/${LAMBALL}`)).json();
    expect(profile.addresses).toMatchObject([{ ip: '203.0.113.7', banned: false }]);
    expect(profile.linkedPlayers).toMatchObject([{ userId: CATTIVA, name: 'CattivaFan', ip: '203.0.113.7' }]);
    expect(profile.live).toMatchObject({ ip: '203.0.113.7', buildingCount: 96 });
    expect(profile.player).toMatchObject({ accountName: 'lamballenjoyer' });
    expect((await get(mod, '/api/v1/players')).json().players[0].ip).toBe('203.0.113.7');

    const viewer = await loginAs(ctx.app, ctx.services, 'viewer');
    const hidden = (await get(viewer, `/api/v1/players/${LAMBALL}`)).json();
    expect(hidden).toMatchObject({ addresses: [], linkedPlayers: [], live: { ip: null } });
    expect((await get(viewer, '/api/v1/players')).json().players.every((p: { ip: unknown }) => p.ip === null)).toBe(true);
    expect((await get(viewer, '/api/v1/players/bans')).json().ipBans).toEqual([]);
  });

  it('never puts addresses on the public website', async () => {
    const res = await api(ctx.app, { method: 'GET', url: '/api/v1/public/players' });
    expect(res.body).not.toContain('203.0.113');
  });
});

describe('address bans', () => {
  it('bans a player together with their address, and lifts both on unban', async () => {
    const admin = await loginAs(ctx.app, ctx.services, 'admin');
    const res = await post(admin, `/api/v1/players/${ANUBIS}/ban`, { reason: 'Cheating', banAddress: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ record: { action: 'ban' }, ipBan: { ip: '198.51.100.23', playerUserId: ANUBIS } });

    // A new account from the same address is kicked on the next online check.
    ctx.services.palworld.mock.join({ name: 'Anubis2', userId: 'steam_76561190000000099', ip: '198.51.100.23' });
    ctx.services.players.markAllOffline();
    await ctx.services.players.refreshOnline();
    await new Promise((r) => setTimeout(r, 0));
    expect(await online()).not.toContain('steam_76561190000000099');
    const history = (await get(admin, '/api/v1/players/steam_76561190000000099')).json().history;
    expect(history).toMatchObject([{ action: 'kick', reason: 'Connected from a banned address', actorUsername: 'PalOps' }]);

    expect((await post(admin, `/api/v1/players/${ANUBIS}/unban`)).statusCode).toBe(200);
    expect((await get(admin, '/api/v1/players/bans')).json().ipBans).toEqual([]);
  });

  it('bans a range and kicks everyone online in it', async () => {
    const admin = await loginAs(ctx.app, ctx.services, 'admin');
    const res = await post(admin, '/api/v1/players/ip-bans', { ip: '203.0.113.0/24', reason: 'Alt farm' });
    expect(res.json().ipBan).toMatchObject({ ip: '203.0.113.0/24', reason: 'Alt farm' });
    expect(await online()).toEqual([ANUBIS]);

    const audit = ctx.services.audit.list({ category: 'players', limit: 10, offset: 0 });
    expect(audit.entries.map((e) => e.action)).toContain('ip_ban');

    const { id } = res.json().ipBan;
    expect((await api(ctx.app, { method: 'DELETE', url: `/api/v1/players/ip-bans/${id}`, cookie: admin })).statusCode).toBe(200);
    expect((await get(admin, '/api/v1/players/bans')).json().ipBans).toEqual([]);
  });

  it('only lets admins ban addresses, and rejects bad input', async () => {
    const mod = await loginAs(ctx.app, ctx.services, 'moderator');
    expect((await post(mod, '/api/v1/players/ip-bans', { ip: '1.2.3.4' })).statusCode).toBe(403);
    const admin = await loginAs(ctx.app, ctx.services, 'admin');
    expect((await post(admin, '/api/v1/players/ip-bans', { ip: 'not an ip' })).statusCode).toBe(400);
    expect((await post(admin, '/api/v1/players/ip-bans', { ip: '0.0.0.0/0' })).statusCode).toBe(400);
    expect((await post(admin, '/api/v1/players/steam_76561199999999999/ban', { banAddress: true })).json().error.code).toBe('no_address');
  });

  it('bans only the account when the address is private or loopback', async () => {
    const admin = await loginAs(ctx.app, ctx.services, 'admin');
    ctx.services.players.recordAddresses(ctx.services.servers.getPrimary()!.id, [{ userId: 'steam_local', ip: '192.168.1.5' }]);
    const res = (await post(admin, '/api/v1/players/steam_local/ban', { banAddress: true })).json();
    expect(res.ipBan).toBeNull();
    expect(res.ipSkipped).toContain('private');
    expect(res.record).toMatchObject({ action: 'ban' });
  });

  it('parses addresses and ranges', () => {
    expect(parseIpRule(' 203.0.113.7 ')).toBe('203.0.113.7');
    expect(parseIpRule('2001:DB8::1')).toBe('2001:db8::1');
    expect(parseIpRule('10.0.0.0/8')).toBe('10.0.0.0/8');
    expect(parseIpRule('10.0.0.0/4')).toBeNull();
    expect(parseIpRule('10.0.0.0/33')).toBeNull();
    expect(parseIpRule('10.0.0.0/8/1')).toBeNull();
    expect(parseIpRule('example.com')).toBeNull();
  });
});
