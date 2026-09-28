import { beforeEach, describe, expect, it } from 'vitest';
import type { PalworldPlayer } from '../src/services/palworld/index.js';
import { api, createTestApp, loginAs } from './helpers.js';

const LAMBALL = 'steam_76561190000000001';
const ANUBIS = 'steam_76561190000000002';
const CATTIVA = 'epic_0f3a9c2b1d';

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let serverId: number;

beforeEach(async () => {
  ctx = await createTestApp({ SITE_SHOW_ONLINE_PLAYERS: 'true' });
  serverId = ctx.services.servers.savePrimary({ name: 'Dev', adapter: 'mock', host: '', port: 8212, username: 'admin' }).id;
  await ctx.services.players.refreshOnline();
});

const p = (name: string, userId: string, level = 10): PalworldPlayer => ({ name, accountName: name, playerId: userId, userId, ip: null, ping: 1, level, location: null, buildingCount: null, guild: null });
const sessions = (userId: string) => ctx.services.db.prepare('SELECT * FROM player_sessions WHERE user_id = ? ORDER BY id').all(userId) as Array<{ started_at: string; ended_at: string | null }>;
const get = (cookie: string, url: string) => api(ctx.app, { method: 'GET', url, cookie });
const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();
/** Backdates a player's open visit and last-seen time, as if they'd been on for a while. */
const backdate = (userId: string, seconds: number) => {
  ctx.services.db.prepare('UPDATE player_sessions SET started_at = ? WHERE user_id = ? AND ended_at IS NULL').run(ago(seconds), userId);
  ctx.services.db.prepare('UPDATE players SET last_seen_at = ? WHERE user_id = ?').run(ago(0), userId);
};
const seed = (userId: string, spans: Array<[number, number | null]>) => {
  ctx.services.db.prepare('DELETE FROM player_sessions WHERE user_id = ?').run(userId);
  for (const [start, end] of spans) ctx.services.db.prepare('INSERT INTO player_sessions (server_id, user_id, started_at, ended_at) VALUES (?, ?, ?, ?)').run(serverId, userId, ago(start), end === null ? null : ago(end));
};

describe('visits and playtime', () => {
  it('opens a visit when a player arrives, keeps it open while they stay, and closes it when they leave', async () => {
    expect(sessions(ANUBIS)).toHaveLength(1);
    expect(sessions(ANUBIS)[0]!.ended_at).toBeNull();
    // Another look while they're still there changes nothing.
    ctx.services.players.record(serverId, [p('Anubis', ANUBIS)]);
    expect(sessions(ANUBIS)).toHaveLength(1);

    backdate(ANUBIS, 600);
    ctx.services.players.record(serverId, [p('Lamball Enjoyer', LAMBALL)]);
    const [visit] = sessions(ANUBIS);
    expect(visit!.ended_at).not.toBeNull();
    expect(Date.parse(visit!.ended_at!)).toBeGreaterThanOrEqual(Date.parse(visit!.started_at));
    // Coming back is a second visit.
    ctx.services.players.record(serverId, [p('Anubis', ANUBIS)]);
    expect(sessions(ANUBIS)).toHaveLength(2);
    expect(ctx.services.players.playtime(ANUBIS).sessions).toBe(2);
  });

  it('adds up time, counting a visit still open up to now', () => {
    seed(ANUBIS, [[7200, 3600], [1800, 900], [300, null]]);
    const t = ctx.services.players.playtime(ANUBIS);
    expect(t.sessions).toBe(3);
    expect(t.longestSeconds).toBe(3600);
    expect(Math.abs(t.seconds - (3600 + 900 + 300))).toBeLessThan(3);
    expect(Math.abs(t.averageSeconds - 1600)).toBeLessThan(3);
    expect(t.recent[0]).toMatchObject({ endedAt: null });
    expect(t.recent).toHaveLength(3);
    const many = ctx.services.players.playtimeOf([ANUBIS, LAMBALL, 'steam_nobody']);
    expect(Math.abs(many.get(ANUBIS)! - 4800)).toBeLessThan(3);
    expect(many.has('steam_nobody')).toBe(false);
  });

  it('ends every visit when the server goes unreachable, so a restart is not counted as playing', async () => {
    ctx.services.players.markAllOffline();
    expect(sessions(ANUBIS)[0]!.ended_at).not.toBeNull();
    expect(sessions(LAMBALL)[0]!.ended_at).not.toBeNull();
    await ctx.services.players.refreshOnline();
    expect(sessions(ANUBIS)).toHaveLength(2);
  });

  it('closes visits left open by a crash of the panel itself', () => {
    // A visit that was open when the panel stopped, for someone who is gone when it starts again.
    ctx.services.db.prepare('DELETE FROM player_sessions').run();
    ctx.services.db.prepare('INSERT INTO player_sessions (server_id, user_id, started_at) VALUES (?, ?, ?)').run(serverId, 'steam_gone', ago(3000));
    ctx.services.players.record(serverId, [p('Anubis', ANUBIS)]);
    expect(sessions('steam_gone')[0]!.ended_at).not.toBeNull();
    expect(sessions(ANUBIS)).toHaveLength(1);
  });

  it('drops visits older than a year', () => {
    seed(ANUBIS, [[400 * 24 * 3600, 399 * 24 * 3600], [3600, 1800]]);
    ctx.services.players.pruneSessions();
    expect(sessions(ANUBIS)).toHaveLength(1);
  });
});

describe('the panel’s player lists', () => {
  const known = async (query: string) => (await get(await loginAs(ctx.app, ctx.services, 'moderator'), `/api/v1/players/known?${query}`)).json();

  it('sort by playtime, level and name', async () => {
    seed(ANUBIS, [[5000, 1000]]);
    seed(LAMBALL, [[9000, 1000]]);
    seed(CATTIVA, [[100, null]]);
    expect((await known('sort=playtime')).players.map((x: { name: string }) => x.name)).toEqual(['Lamball Enjoyer', 'Anubis', 'CattivaFan']);
    expect((await known('sort=level')).players.map((x: { name: string }) => x.name)).toEqual(['Anubis', 'Lamball Enjoyer', 'CattivaFan']);
    expect((await known('sort=name')).players.map((x: { name: string }) => x.name)).toEqual(['Anubis', 'CattivaFan', 'Lamball Enjoyer']);
    const row = (await known('sort=playtime')).players[0];
    expect(Math.abs(row.playtimeSeconds - 8000)).toBeLessThan(3);
    expect((await known('sort=bogus')).error).toBeDefined();
  });

  it('filter to online, banned and linked players, and say whether a link is verified', async () => {
    await ctx.services.moderation.ban({ userId: null, username: 't' }, CATTIVA, 'x');
    await ctx.services.palworld.mock.kick(ANUBIS);
    ctx.services.players.markAllOffline();
    await ctx.services.players.refreshOnline();
    expect((await known('filter=online')).players.map((x: { name: string }) => x.name).sort()).toEqual(['Lamball Enjoyer']);
    expect((await known('filter=banned')).players.map((x: { name: string }) => x.name)).toEqual(['CattivaFan']);

    const one = ctx.services.siteAccounts.signIn({ id: '600000000000000001', username: 'one', avatar: null });
    const two = ctx.services.siteAccounts.signIn({ id: '600000000000000002', username: 'two', avatar: null });
    ctx.services.siteAccounts.linkPlayer(one.id, ctx.services.players.find('Lamball Enjoyer')[0]!.id);
    ctx.services.siteAccounts.verify(one.id, 'staff');
    ctx.services.siteAccounts.linkPlayer(two.id, ctx.services.players.find('Anubis')[0]!.id);
    expect((await known('filter=linked')).players.map((x: { name: string }) => x.name).sort()).toEqual(['Anubis', 'Lamball Enjoyer']);
    expect((await known('filter=verified')).players.map((x: { name: string }) => x.name)).toEqual(['Lamball Enjoyer']);
    expect((await known('filter=unverified')).players.map((x: { name: string }) => x.name)).toEqual(['Anubis']);
    const all = (await known('')).players;
    expect(all.find((x: { name: string }) => x.name === 'Lamball Enjoyer').link).toBe('verified');
    expect(all.find((x: { name: string }) => x.name === 'Anubis').link).toBe('claimed');
    expect(all.find((x: { name: string }) => x.name === 'CattivaFan').link).toBeNull();
    // Search still works alongside a filter.
    expect((await known('filter=linked&search=anu')).total).toBe(1);
  });

  it('put activity in a player’s profile', async () => {
    seed(ANUBIS, [[7200, 3600], [300, null]]);
    const cookie = await loginAs(ctx.app, ctx.services, 'viewer');
    const profile = (await get(cookie, `/api/v1/players/${ANUBIS}`)).json();
    expect(profile.activity).toMatchObject({ sessions: 2, longestSeconds: 3600 });
    expect(profile.activity.recent).toHaveLength(2);
  });
});

describe('the public directory and profiles', () => {
  const pub = (path: string) => api(ctx.app, { method: 'GET', url: `/api/v1/public${path}` });

  it('list players with playtime and a verified badge, and never a platform ID or address', async () => {
    seed(ANUBIS, [[3600, null]]);
    const acc = ctx.services.siteAccounts.signIn({ id: '600000000000000001', username: 'one', avatar: null });
    ctx.services.siteAccounts.linkPlayer(acc.id, ctx.services.players.find('Anubis')[0]!.id);
    ctx.services.siteAccounts.verify(acc.id, 'staff');
    const res = await pub('/players/known?sort=playtime');
    const players = res.json().players;
    expect(players[0]).toMatchObject({ name: 'Anubis', level: 47, verified: true, online: true });
    expect(Math.abs(players[0].playtimeSeconds - 3600)).toBeLessThan(3);
    expect(Object.keys(players[0]).sort()).toEqual(['guild', 'id', 'lastSeenAt', 'level', 'name', 'online', 'playtimeSeconds', 'verified']);
    expect(res.body).not.toMatch(/steam_|epic_|198\.51|203\.0/);
    expect((await pub('/players/known?search=lamb')).json().total).toBe(1);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('show a profile with stats, pals and the guild, and the Discord name only when the player chose to', async () => {
    seed(ANUBIS, [[7200, 3600], [600, null]]);
    ctx.services.world.ingest({
      serverTime: null,
      fps: 60,
      averageFps: 60,
      characters: [
        { instanceId: 'pl-a', unitType: 'Player', name: 'Anubis', className: null, trainerInstanceId: null, userId: ANUBIS, ip: null, level: 47, hp: 1, maxHp: 1, guildId: 'G1', guildName: 'Desert Kings', location: { x: 0, y: 0, z: 0 } },
        ...[20, 45, 33, 12, 50, 8, 41].map((level, i) => ({ instanceId: `pal-${i}`, unitType: 'OtomoPal' as const, name: '', className: `Pal${i}`, trainerInstanceId: 'pl-a', userId: null, ip: null, level, hp: 1, maxHp: 1, guildId: 'G1', guildName: 'Desert Kings', location: { x: 0, y: 0, z: 0 } })),
      ],
      palBoxes: [{ guildId: 'G1', guildName: 'Desert Kings', location: { x: 10, y: 10, z: 0 } }],
    });
    const id = ctx.services.players.find('Anubis')[0]!.id;
    const profile = (await pub(`/players/${id}`)).json();
    expect(profile).toMatchObject({ name: 'Anubis', level: 47, sessions: 2, guildInfo: { name: 'Desert Kings', bases: 1 }, verified: false, discord: null });
    expect(Math.abs(profile.playtimeSeconds - 4200)).toBeLessThan(3);
    expect(profile.longestSessionSeconds).toBe(3600);
    expect(profile.pals.map((x: { level: number }) => x.level)).toEqual([50, 45, 41, 33, 20, 12]);

    const acc = ctx.services.siteAccounts.signIn({ id: '600000000000000001', username: 'anubisfan', avatar: null });
    ctx.services.siteAccounts.linkPlayer(acc.id, id);
    // An unverified claim never shows anything.
    ctx.services.siteAccounts.setShowDiscord(acc.id, true);
    expect((await pub(`/players/${id}`)).json().discord).toBeNull();
    ctx.services.siteAccounts.verify(acc.id, 'staff');
    expect((await pub(`/players/${id}`)).json()).toMatchObject({ verified: true, discord: { username: 'anubisfan' } });
    ctx.services.siteAccounts.setShowDiscord(acc.id, false);
    expect((await pub(`/players/${id}`)).json().discord).toBeNull();
    expect((await pub('/players/99999')).statusCode).toBe(404);
    expect((await pub('/players/abc')).statusCode).toBe(400);
  });

  it('follow the switch that hides the player list', async () => {
    const hidden = await createTestApp({ SITE_SHOW_ONLINE_PLAYERS: 'false' });
    expect((await api(hidden.app, { method: 'GET', url: '/api/v1/public/players/known' })).statusCode).toBe(403);
    expect((await api(hidden.app, { method: 'GET', url: '/api/v1/public/players/1' })).statusCode).toBe(403);
  });
});
