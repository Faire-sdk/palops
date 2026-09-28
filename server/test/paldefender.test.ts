import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PalDefenderClient } from '../src/services/paldefender/paldefender-client.js';
import { api, createTestApp, loginAs } from './helpers.js';

const TOKEN = 'pd-token-abc';
const ANUBIS = 'steam_76561190000000002';

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
  auth: string | undefined;
}

let fake: Server;
let port: number;
let calls: Call[] = [];
/** Paths (without the /v1/pdapi/ prefix) that answer with a canned error. */
let failing = new Map<string, { status: number; code: string }>();

const BANLIST = {
  Banlist: {
    Version: 1,
    BannedMessage: 'You are banned',
    UserEntries: [
      { UserId: 'steam_1', Active: true, BannedBy: { Type: 'anticheat', NameValue: 'PalDefender', IP: '', Reason: 'Item spawning', Timestamp: { UTC: 1790000000 } } },
      { UserId: 'steam_2', Active: false, BannedBy: { Type: 'rest', NameValue: 'AdminPanel', Reason: 'x', Timestamp: { UTC: 1780000000 } }, UnbannedBy: { Type: 'rest', NameValue: 'AdminPanel', Reason: '', Timestamp: { UTC: 1785000000 } } },
    ],
    IPEntries: [{ IP: '203.0.113.42', Active: true, BannedBy: { Type: 'console', NameValue: 'Console', Reason: 'Bot traffic', Timestamp: { UTC: 1791000000 } }, UnbannedBy: null }],
  },
};

const READS: Record<string, unknown> = {
  pals: {
    Meta: { PlayerUID: 'uid-1', Player: 'Anubis', TeamCount: 1 },
    Pals: {
      Team: { 'pal-a': { PalID: 'Anubis', Nickname: 'Big A', Gender: 'Male', Level: 40, Shiny: true, HP: 5200, Passives: ['Legend'], ActiveSkills: ['Sand Tornado'], team_slot_index: 0 } },
      Palbox: { 'pal-b': { PalID: 'Lamball', Level: 3, page: 1, slot: 4 }, 'pal-c': { PalID: 'Cattiva', Level: 5, page: 0, slot: 2 } },
      BaseCamps: [{ id: 'camp-1', level: 4, state: 'Active', map_pos: { x: 10, y: 20, z: 0 }, pals: { 'pal-d': { PalID: 'Penking', Level: 22, base_camp_slot_index: 3 } } }],
    },
  },
  items: {
    Meta: { PlayerUID: 'uid-1', Player: 'Anubis' },
    Inventory: {
      Items: { Available: true, UsedSlots: 2, MaxSlots: 42, Slots: { '3': { ItemID: 'Money', Count: 900 }, '0': { ItemID: 'Wood', Count: 50 } } },
      Weapons: { Available: false },
    },
  },
  techs: { Meta: { PlayerUID: 'uid-1', Player: 'Anubis', UnlockedCount: 2, LockedCount: 8, TotalCount: 10 }, Techs: { Unlocked: ['Technology_A', 'Technology_B'] } },
  progression: { Meta: { PlayerUID: 'uid-1', Player: 'Anubis' }, Progression: { Player: { level: 47, exp: 1000, unusedStatusPoints: 3 }, Currencies: { technologyPoints: 12 } } },
};
const GUILDS = { Meta: { GuildCount: 1 }, Guilds: { 'guild-1': { name: 'Desert Kings', Level: 6, admin: { id: 'uid-1', name: 'Anubis' }, camp_count: 1, camps: [{ id: 'camp-1', map_pos: { x: 10, y: 20, z: 0 } }], member_count: 2, members: ['Anubis', 'Sandy'] } } };
const GUILD = {
  Guild: {
    name: 'Desert Kings',
    Level: 6,
    admin: { id: 'uid-1', name: 'Anubis' },
    members: [{ player_uid: 'uid-1', player_name: 'Anubis', status: 'Online' }],
    camps: [{ id: 'camp-1', level: 4, state: 'Active', map_pos: { x: 10, y: 20, z: 0 } }],
    items: { container_id: 'c', current: 30, max: 100 },
    laboratory: { current_research: 'Research_Speed' },
  },
};

beforeAll(async () => {
  fake = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const path = (req.url ?? '').replace('/v1/pdapi/', '');
      const send = (status: number, body: unknown) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { Error: { Code: 'INVALID_TOKEN', Message: 'bad token', Details: {} } });
      calls.push({ method: req.method ?? '', path, body: raw ? (JSON.parse(raw) as Record<string, unknown>) : null, auth: req.headers.authorization });
      const fail = failing.get(path.split('?')[0]!.split('/')[0]!);
      if (fail) return send(fail.status, { Error: { Code: fail.code, Message: `${fail.code} happened`, Details: {} } });
      if (path === 'version') return send(200, { Version: { Major: 1, Minor: 7, Patch: 2, Build: 9, Version: '1.7.2', VersionLong: '1.7.2.9', Beta: false } });
      if (path === 'players') {
        return send(200, {
          Meta: { PlayerCount: 2, OnlineCount: 1 },
          Players: [
            { Name: 'Anubis', IP: '198.51.100.23', PlayerUID: 'uid-1', UserId: ANUBIS, GuildName: 'Desert Kings', GuildUUID: 'g', Status: 'Online' },
            { Name: 'Offline Ollie', IP: '192.0.2.77', PlayerUID: 'uid-2', UserId: 'steam_ollie', Status: 'Offline' },
            { Name: 'No Address', IP: '', UserId: 'steam_x' },
          ],
        });
      }
      if (path.startsWith('banlist')) return send(200, BANLIST);
      if (path.startsWith('ban/')) return send(200, { Success: true, UserId: decodeURIComponent(path.slice(4)), IP: true, BannedIP: '198.51.100.23', Kicked: 1 });
      if (path.startsWith('banip/')) return send(200, { Success: true, IP: decodeURIComponent(path.slice(6)), UserId: '', Kicked: 0 });
      if (path.startsWith('unban')) return send(200, { Success: true });
      if (/^(pals|items|techs|progression)\//.test(path)) {
        if (path.endsWith('steam_offline')) return send(404, { Error: { Code: 'PLAYER_NOT_FOUND', Message: 'No online player matches', Details: {} } });
        return send(200, READS[path.split('/')[0]!]);
      }
      if (path === 'guilds') return send(200, GUILDS);
      if (path.startsWith('guild/')) return path.endsWith('nope') ? send(404, { Error: { Code: 'GUILD_NOT_FOUND', Message: 'no guild', Details: {} } }) : send(200, GUILD);
      if (path.startsWith('give/items/')) return send(200, { Granted: { Items: (calls.at(-1)!.body!.Items as unknown[]).length } });
      if (path.startsWith('give/pals/')) return send(200, { Granted: { Pals: (calls.at(-1)!.body!.Pals as unknown[]).length } });
      if (path.startsWith('give/paleggs/')) return send(200, { Granted: { PalEggs: 1 } });
      if (path.startsWith('give/paltemplate/')) return send(200, { Granted: { PalTemplates: 1 } });
      if (path.startsWith('give/progression/')) return send(200, { Granted: { EXP: 100 }, Totals: { TechnologyPoints: 50 } });
      if (path.startsWith('learntech/')) return send(200, { UnlockedCount: 1, Unlocked: ['Technology_ElecBaton'], Skipped: [] });
      if (path.startsWith('forgettech/')) return send(200, { ForgottenCount: 1, Forgotten: 'All', Skipped: [] });
      if (path.startsWith('summon/')) return send(200, { Summoned: { Type: path.endsWith('npc') ? 'NPC' : 'Pal', Level: 30 } });
      if (path.startsWith('deletebase/')) return send(200, { BaseCamp: { Id: path.slice(11), Summary: 'Base of Desert Kings' }, Deleted: { Buildings: 12, PalBox: true, Note: 'x' }, Archive: 'Archive/base.json' });
      if (path === 'SendPlayerMessage') return send(200, { Success: true, SentCount: 1 });
      if (['Alert', 'Broadcast', 'ReloadConfig'].includes(path)) return send(200, { Success: true });
      return send(404, { Error: { Code: 'NOT_FOUND', Message: 'no such endpoint', Details: {} } });
    });
  });
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
  port = (fake.address() as AddressInfo).port;
});

afterAll(() => new Promise<void>((r) => fake.close(() => r())));

let ctx: Awaited<ReturnType<typeof createTestApp>>;

beforeEach(async () => {
  calls = [];
  failing = new Map();
  ctx = await createTestApp();
  ctx.services.servers.savePrimary({ name: 'Dev', adapter: 'mock', host: '', port: 8212, username: 'admin' });
  await ctx.services.players.refreshOnline();
});

const get = (cookie: string, url: string) => api(ctx.app, { method: 'GET', url, cookie });
const post = (cookie: string, url: string, payload: Record<string, unknown> = {}) => api(ctx.app, { method: 'POST', url, cookie, payload });
const put = (cookie: string, url: string, payload: Record<string, unknown>) => api(ctx.app, { method: 'PUT', url, cookie, payload });
const enable = (cookie: string, token = TOKEN) => put(cookie, '/api/v1/paldefender/settings', { enabled: true, host: '127.0.0.1', port, useTls: false, token });

describe('PalDefender client', () => {
  const client = (token = TOKEN) => new PalDefenderClient({ host: '127.0.0.1', port, useTls: false, token });

  it('reads the version, players and ban list into panel types', async () => {
    expect(await client().version()).toBe('1.7.2.9');
    expect((await client().players())[0]).toEqual({ name: 'Anubis', ip: '198.51.100.23', playerUid: 'uid-1', userId: ANUBIS, guildName: 'Desert Kings', status: 'Online' });
    const bans = await client().banlist();
    expect(bans).toHaveLength(3);
    expect(bans[0]).toEqual({
      kind: 'user',
      id: 'steam_1',
      active: true,
      reason: 'Item spawning',
      bannedBy: 'PalDefender',
      bannedVia: 'anticheat',
      bannedAt: new Date(1790000000 * 1000).toISOString(),
      unbannedAt: null,
    });
    expect(bans.find((b) => b.id === 'steam_2')).toMatchObject({ active: false, unbannedAt: new Date(1785000000 * 1000).toISOString() });
    expect(bans.find((b) => b.kind === 'ip')).toMatchObject({ id: '203.0.113.42', reason: 'Bot traffic', bannedVia: 'console' });
  });

  it('sends the token as a bearer and explains failures', async () => {
    await client().version();
    expect(calls[0]!.auth).toBe(`Bearer ${TOKEN}`);
    await expect(client('wrong').version()).rejects.toMatchObject({ code: 'unauthorized' });
    failing.set('banlist', { status: 403, code: 'MISSING_PERMISSION' });
    await expect(client().banlist()).rejects.toMatchObject({ code: 'missing_permission', message: expect.stringContaining('REST.Banlist.Read') });
    failing.set('unban', { status: 404, code: 'BAN_NOT_FOUND' });
    await expect(client().unban('steam_9')).rejects.toMatchObject({ code: 'not_found', apiCode: 'BAN_NOT_FOUND' });
    const dead = new PalDefenderClient({ host: '127.0.0.1', port: 1, useTls: false, token: TOKEN, timeoutMs: 500 });
    await expect(dead.version()).rejects.toMatchObject({ code: 'unreachable' });
  });
});

describe('PalDefender integration is optional', () => {
  it('is off by default and changes nothing about bans', async () => {
    const admin = await loginAs(ctx.app, ctx.services, 'admin');
    expect((await get(admin, '/api/v1/paldefender/status')).json()).toMatchObject({ enabled: false });
    expect((await get(admin, '/api/v1/paldefender/banlist')).statusCode).toBe(409);

    const res = (await post(admin, `/api/v1/players/${ANUBIS}/ban`, { reason: 'x', banAddress: true })).json();
    expect(res).toMatchObject({ record: { action: 'ban' }, paldefender: null });
    expect((await post(admin, '/api/v1/players/ip-bans', { ip: '203.0.113.9' })).json().paldefender).toBeNull();
    expect(calls).toEqual([]);
  });

  it('is configured by owners only, and never returns the token', async () => {
    const admin = await loginAs(ctx.app, ctx.services, 'admin');
    expect((await get(admin, '/api/v1/paldefender/settings')).statusCode).toBe(403);
    expect((await enable(admin)).statusCode).toBe(403);

    const owner = await loginAs(ctx.app, ctx.services, 'owner');
    const saved = await enable(owner);
    expect(saved.statusCode).toBe(200);
    expect(saved.json().settings).toMatchObject({ enabled: true, host: '127.0.0.1', port, useTls: false, hasToken: true });
    expect(JSON.stringify(saved.json())).not.toContain(TOKEN);
    const raw = ctx.services.db.prepare('SELECT token_encrypted FROM paldefender').get() as { token_encrypted: string };
    expect(raw.token_encrypted).not.toContain(TOKEN);

    // Leaving the token blank keeps the stored one.
    await put(owner, '/api/v1/paldefender/settings', { enabled: true, host: '127.0.0.1', port, useTls: false, token: '' });
    expect((await post(owner, '/api/v1/paldefender/test', { host: '127.0.0.1', port, useTls: false })).json().version).toBe('1.7.2.9');

    const audit = ctx.services.audit.list({ category: 'server', limit: 5, offset: 0 }).entries[0]!;
    expect(audit.action).toBe('paldefender_updated');
    expect(JSON.stringify(audit)).not.toContain(TOKEN);

    expect((await put(owner, '/api/v1/paldefender/settings', { enabled: true, host: 'http://evil', port, useTls: false })).statusCode).toBe(400);
  });

  it('will not switch on without a token', async () => {
    const owner = await loginAs(ctx.app, ctx.services, 'owner');
    const res = await put(owner, '/api/v1/paldefender/settings', { enabled: true, host: '127.0.0.1', port, useTls: false });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('token_required');
    // Saved switched off without a token is fine; a token can be added later.
    expect((await put(owner, '/api/v1/paldefender/settings', { enabled: false, host: '127.0.0.1', port, useTls: false })).statusCode).toBe(200);
  });

  it('tells the owner which token permission is missing', async () => {
    const owner = await loginAs(ctx.app, ctx.services, 'owner');
    failing.set('banlist', { status: 403, code: 'MISSING_PERMISSION' });
    const res = (await post(owner, '/api/v1/paldefender/test', { host: '127.0.0.1', port, useTls: false, token: TOKEN })).json();
    expect(res.checks.map((c: { permission: string; ok: boolean }) => [c.permission, c.ok])).toEqual([
      ['REST.Version.Read', true],
      ['REST.Players.Read', true],
      ['REST.Banlist.Read', false],
      ['REST.Guilds.Read', true],
    ]);
    expect(res.checks[2].message).toContain('REST.Banlist.Read');

    const wrong = (await post(owner, '/api/v1/paldefender/test', { host: '127.0.0.1', port, useTls: false, token: 'nope' })).json();
    expect(wrong.version).toBeNull();
    expect(wrong.checks.every((c: { ok: boolean }) => !c.ok)).toBe(true);
    expect((await post(owner, '/api/v1/paldefender/test', { host: '127.0.0.1', port, useTls: false })).statusCode).toBe(409);
  });
});

describe('with PalDefender switched on', () => {
  let admin: string;
  beforeEach(async () => {
    await enable(await loginAs(ctx.app, ctx.services, 'owner'));
    admin = await loginAs(ctx.app, ctx.services, 'admin');
  });

  it('mirrors a ban with the address to PalDefender', async () => {
    const res = (await post(admin, `/api/v1/players/${ANUBIS}/ban`, { reason: 'Griefing', banAddress: true })).json();
    expect(res.paldefender).toEqual({ ok: true, message: null });
    expect(res.ipBan.ip).toBe('198.51.100.23');
    expect(calls.find((c) => c.path === `ban/${ANUBIS}`)).toMatchObject({ method: 'POST', body: { Reason: 'Griefing', IP: true } });
  });

  it('does not ask PalDefender for an address the panel refused to ban', async () => {
    ctx.services.players.recordAddresses(ctx.services.servers.getPrimary()!.id, [{ userId: 'steam_lan', ip: '192.168.1.5' }]);
    const res = (await post(admin, '/api/v1/players/steam_lan/ban', { banAddress: true })).json();
    expect(res.ipSkipped).toContain('private');
    expect(calls.find((c) => c.path === 'ban/steam_lan')!.body).toMatchObject({ IP: false });
  });

  it('mirrors address bans, unbans and lifted addresses', async () => {
    const ban = (await post(admin, '/api/v1/players/ip-bans', { ip: '203.0.113.9', reason: 'Bots' })).json();
    expect(ban.paldefender).toEqual({ ok: true, message: null });
    expect(calls.find((c) => c.path === 'banip/203.0.113.9')).toMatchObject({ body: { Reason: 'Bots' } });

    const del = await api(ctx.app, { method: 'DELETE', url: `/api/v1/players/ip-bans/${ban.ipBan.id}`, cookie: admin });
    expect(del.json().paldefender).toEqual({ ok: true, message: null });
    expect(calls.some((c) => c.path === 'unbanip/203.0.113.9')).toBe(true);

    await post(admin, `/api/v1/players/${ANUBIS}/ban`, { banAddress: true });
    calls = [];
    const unban = (await post(admin, `/api/v1/players/${ANUBIS}/unban`)).json();
    expect(unban.paldefender).toEqual({ ok: true, message: null });
    expect(calls.map((c) => c.path)).toEqual([`unban/${ANUBIS}`, 'unbanip/198.51.100.23']);
  });

  it('treats "was not banned" as fine when unbanning', async () => {
    failing.set('unban', { status: 404, code: 'BAN_NOT_FOUND' });
    const res = (await post(admin, `/api/v1/players/${ANUBIS}/unban`)).json();
    expect(res.paldefender).toEqual({ ok: true, message: null });
  });

  it('still bans when PalDefender fails, and says so', async () => {
    failing.set('ban', { status: 500, code: 'REQUEST_TIMEOUT' });
    const res = await post(admin, `/api/v1/players/${ANUBIS}/ban`, { reason: 'x' });
    expect(res.statusCode).toBe(200);
    expect(res.json().record).toMatchObject({ action: 'ban' });
    expect(res.json().paldefender).toMatchObject({ ok: false, message: expect.stringContaining('PalDefender:') });
    expect(ctx.services.moderation.isBanned(ANUBIS)).toBe(true);

    failing = new Map([['ban', { status: 403, code: 'MISSING_PERMISSION' }]]);
    const denied = (await post(admin, `/api/v1/players/steam_other/ban`)).json();
    expect(denied.paldefender.message).toContain('REST.Punishments.Ban');
  });

  it('lists PalDefender bans, including ones made elsewhere, for staff only', async () => {
    const mod = await loginAs(ctx.app, ctx.services, 'moderator');
    const active = (await get(mod, '/api/v1/paldefender/banlist')).json().bans;
    expect(calls.at(-1)!.path).toBe('banlist?active=true');
    expect(active.map((b: { id: string }) => b.id)).toEqual(expect.arrayContaining(['steam_1', '203.0.113.42']));
    await get(mod, '/api/v1/paldefender/banlist?includeInactive=true');
    expect(calls.at(-1)!.path).toBe('banlist');

    const viewer = await loginAs(ctx.app, ctx.services, 'viewer');
    expect((await get(viewer, '/api/v1/paldefender/banlist')).statusCode).toBe(403);
    expect((await get(viewer, '/api/v1/paldefender/status')).json()).toMatchObject({ enabled: true });
  });

  it('unbans from PalDefender only, for admins, and audits it', async () => {
    const mod = await loginAs(ctx.app, ctx.services, 'moderator');
    expect((await post(mod, '/api/v1/paldefender/unban', { userId: 'steam_1' })).statusCode).toBe(403);
    expect((await post(admin, '/api/v1/paldefender/unban', { userId: 'steam_1', reason: 'Appeal accepted' })).statusCode).toBe(200);
    expect(calls.at(-1)).toMatchObject({ path: 'unban/steam_1', body: { Reason: 'Appeal accepted' } });
    expect((await post(admin, '/api/v1/paldefender/unbanip', { ip: '203.0.113.42' })).statusCode).toBe(200);
    expect((await post(admin, '/api/v1/paldefender/unbanip', { ip: 'nope' })).statusCode).toBe(400);
    expect(ctx.services.audit.list({ category: 'players', limit: 5, offset: 0 }).entries.map((e) => e.action)).toEqual(expect.arrayContaining(['paldefender_unban', 'paldefender_ip_unban']));

    failing.set('unban', { status: 404, code: 'BAN_NOT_FOUND' });
    expect((await post(admin, '/api/v1/paldefender/unban', { userId: 'steam_404' })).statusCode).toBe(404);
  });

  it('records addresses of offline players', async () => {
    calls = [];
    expect(await ctx.services.paldefender.syncPlayers()).toBe(3);
    const ips = ctx.services.players.addressesOf('steam_ollie');
    expect(ips.map((i) => i.ip)).toEqual(['192.0.2.77']);
    expect(ctx.services.paldefender.status()).toMatchObject({ enabled: true, version: '1.7.2.9', error: null, lastSyncAt: expect.any(String) });
  });

  it('reports a sync failure in the status instead of throwing on the panel', async () => {
    failing.set('players', { status: 500, code: 'REQUEST_FAILED' });
    await expect(ctx.services.paldefender.syncPlayers()).rejects.toThrow();
    expect(ctx.services.paldefender.status().error).toContain('REQUEST_FAILED');
  });
});

describe('PalDefender player data, guilds and world changes', () => {
  const OLLIE = 'steam_ollie';
  const body = (call: Call | undefined) => call?.body as Record<string, unknown>;
  let owner: string;
  let admin: string;
  let mod: string;
  beforeEach(async () => {
    owner = await loginAs(ctx.app, ctx.services, 'owner');
    await enable(owner);
    admin = await loginAs(ctx.app, ctx.services, 'admin');
    mod = await loginAs(ctx.app, ctx.services, 'moderator');
  });
  const client = () => new PalDefenderClient({ host: '127.0.0.1', port, useTls: false, token: TOKEN });

  it('reads pals, items, techs, progression and guilds into panel types', async () => {
    const pals = await client().pals(ANUBIS);
    expect(pals.player).toEqual({ uid: 'uid-1', name: 'Anubis' });
    expect(pals.team[0]).toMatchObject({ instanceId: 'pal-a', palId: 'Anubis', nickname: 'Big A', level: 40, shiny: true, passives: ['Legend'], slot: 0 });
    // Box pals are ordered by page, then slot.
    expect(pals.palbox.map((p) => p.palId)).toEqual(['Cattiva', 'Lamball']);
    expect(pals.baseCamps[0]).toMatchObject({ id: 'camp-1', level: 4, mapPos: { x: 10, y: 20, z: 0 }, pals: [{ palId: 'Penking', slot: 3 }] });

    const items = await client().items(ANUBIS);
    expect(items.containers.find((c) => c.name === 'Items')).toMatchObject({ usedSlots: 2, maxSlots: 42, slots: [{ slot: 0, itemId: 'Wood', count: 50 }, { slot: 3, itemId: 'Money', count: 900 }] });
    expect(items.containers.find((c) => c.name === 'Weapons')).toMatchObject({ available: false, slots: [] });

    expect(await client().techs(ANUBIS)).toMatchObject({ unlocked: ['Technology_A', 'Technology_B'], unlockedCount: 2, lockedCount: 8, totalCount: 10 });
    expect((await client().progression(ANUBIS)).progression).toMatchObject({ Player: { level: 47 }, Currencies: { technologyPoints: 12 } });

    expect(await client().guilds()).toEqual([
      { id: 'guild-1', name: 'Desert Kings', level: 6, admin: { id: 'uid-1', name: 'Anubis' }, memberCount: 2, campCount: 1, members: ['Anubis', 'Sandy'], camps: [{ id: 'camp-1', mapPos: { x: 10, y: 20, z: 0 } }] },
    ]);
    expect(await client().guild('guild-1')).toMatchObject({ name: 'Desert Kings', storage: { used: 30, max: 100 }, currentResearch: 'Research_Speed', camps: [{ id: 'camp-1', level: 4 }] });
  });

  it('shows player data to staff, and says so when the player is offline', async () => {
    expect((await get(mod, `/api/v1/paldefender/players/${ANUBIS}/items`)).json().containers).toHaveLength(2);
    expect((await get(mod, `/api/v1/paldefender/players/${ANUBIS}/pals`)).json().team).toHaveLength(1);
    expect((await get(mod, '/api/v1/paldefender/guilds')).json().guilds[0].name).toBe('Desert Kings');
    expect((await get(mod, '/api/v1/paldefender/guilds/guild-1')).json().guild.name).toBe('Desert Kings');

    const offline = await get(mod, '/api/v1/paldefender/players/steam_offline/techs');
    expect(offline.statusCode).toBe(404);
    expect(offline.json().error.code).toBe('paldefender_not_found');

    const viewer = await loginAs(ctx.app, ctx.services, 'viewer');
    expect((await get(viewer, `/api/v1/paldefender/players/${ANUBIS}/items`)).statusCode).toBe(403);
    expect((await get(viewer, '/api/v1/paldefender/guilds')).statusCode).toBe(403);
  });

  it('lets only admins change the game world', async () => {
    const attempts: Array<[string, Record<string, unknown>]> = [
      [`/api/v1/paldefender/players/${ANUBIS}/give/items`, { items: [{ itemId: 'Money', count: 5 }] }],
      [`/api/v1/paldefender/players/${ANUBIS}/give/pals`, { pals: [{ palId: 'Anubis', level: 10 }] }],
      [`/api/v1/paldefender/players/${ANUBIS}/tech/learn`, { technology: 'All' }],
      ['/api/v1/paldefender/summon/npc', { npcId: 'PIDF_Soldier', x: 1, y: 2, z: 3 }],
      ['/api/v1/paldefender/bases/11111111-2222-3333-4444-555555555555/delete', { confirm: true }],
      ['/api/v1/paldefender/reload-config', {}],
    ];
    for (const [url, payload] of attempts) {
      expect((await post(mod, url, payload)).statusCode, url).toBe(403);
      expect((await post(admin, url, payload)).statusCode, url).toBe(200);
    }
  });

  it('gives items, pals, eggs, templates and progression, and audits each', async () => {
    const items = await post(admin, `/api/v1/paldefender/players/${ANUBIS}/give/items`, { items: [{ itemId: 'ExplosiveBullet', count: 500 }, { itemId: 'Money', count: 10 }] });
    expect(items.json()).toEqual({ granted: 2 });
    expect(body(calls.find((c) => c.path === `give/items/${ANUBIS}`))).toEqual({ Items: [{ ItemID: 'ExplosiveBullet', Count: 500 }, { ItemID: 'Money', Count: 10 }] });

    await post(admin, `/api/v1/paldefender/players/${ANUBIS}/give/pals`, { pals: [{ palId: 'Anubis', level: 35 }] });
    expect(body(calls.find((c) => c.path.startsWith('give/pals/')))).toEqual({ Pals: [{ PalID: 'Anubis', Level: 35 }] });

    await post(admin, `/api/v1/paldefender/players/${ANUBIS}/give/eggs`, { eggs: [{ eggId: 'PalEgg_Fire_01', palId: 'Foxparks', level: 12 }] });
    expect(body(calls.find((c) => c.path.startsWith('give/paleggs/')))).toEqual({ PalEggs: [{ EggID: 'PalEgg_Fire_01', PalID: 'Foxparks', Level: 12 }] });

    await post(admin, `/api/v1/paldefender/players/${ANUBIS}/give/templates`, { templates: ['starter_pengullet.json'] });
    expect(body(calls.find((c) => c.path.startsWith('give/paltemplate/')))).toEqual({ PalTemplates: ['starter_pengullet.json'] });

    const prog = await post(admin, `/api/v1/paldefender/players/${ANUBIS}/give/progression`, { exp: 100, relics: { CapturePower: 5 } });
    expect(prog.json()).toEqual({ granted: { EXP: 100 }, totals: { TechnologyPoints: 50 } });
    expect(body(calls.find((c) => c.path.startsWith('give/progression/')))).toEqual({ EXP: 100, Relics: { CapturePower: 5 } });

    const actions = ctx.services.audit.list({ category: 'players', limit: 20, offset: 0 }).entries.map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['paldefender_give_items', 'paldefender_give_pals', 'paldefender_give_eggs', 'paldefender_give_templates', 'paldefender_give_progression']));
    expect(ctx.services.audit.list({ category: 'players', limit: 1, offset: 0 }).entries[0]).toMatchObject({ actorUsername: 'admin-user', target: ANUBIS, details: { exp: 100 } });
  });

  it('teaches and forgets technologies', async () => {
    const learn = await post(admin, `/api/v1/paldefender/players/${ANUBIS}/tech/learn`, { technology: ['Technology_ElecBaton'] });
    expect(learn.json()).toEqual({ unlocked: ['Technology_ElecBaton'], skipped: [] });
    expect(body(calls.at(-1))).toEqual({ Technology: ['Technology_ElecBaton'] });
    const forget = await post(admin, `/api/v1/paldefender/players/${ANUBIS}/tech/forget`, { technology: 'All' });
    expect(forget.json()).toEqual({ forgotten: ['All'], skipped: [] });
    expect(body(calls.at(-1))).toEqual({ Technology: 'All' });
  });

  it('summons pals and NPCs', async () => {
    const pal = await post(admin, '/api/v1/paldefender/summon/pal', { palId: 'Anubis', x: 230, y: -486, z: 4097, level: 30, uncapturable: true, disableStatuses: ['Burn'] });
    expect(pal.json().summoned).toMatchObject({ Type: 'Pal' });
    expect(body(calls.at(-1))).toEqual({ PalID: 'Anubis', X: 230, Y: -486, Z: 4097, Level: 30, Uncapturable: true, DisableAI: false, DisableDamageMeter: false, DisableStatuses: ['Burn'] });

    await post(admin, '/api/v1/paldefender/summon/pal', { palTemplate: 'ArenaBoss.json', x: 1, y: 2, z: 3 });
    expect(body(calls.at(-1))).toMatchObject({ PalTemplate: 'ArenaBoss.json' });
    expect(body(calls.at(-1))).not.toHaveProperty('PalID');

    await post(admin, '/api/v1/paldefender/summon/npc', { npcId: 'PIDF_Soldier_AssaultRifle', level: 30, x: 230, y: -486, z: 4097 });
    expect(body(calls.at(-1))).toEqual({ NPCID: 'PIDF_Soldier_AssaultRifle', X: 230, Y: -486, Z: 4097, Level: 30, Uncapturable: false, DisableAI: false });
  });

  it('deletes a base only when confirmed, and audits what was removed', async () => {
    const url = '/api/v1/paldefender/bases/11111111-2222-3333-4444-555555555555/delete';
    expect((await post(admin, url, {})).statusCode).toBe(400);
    expect(calls.some((c) => c.path.startsWith('deletebase/'))).toBe(false);

    const res = (await post(admin, url, { confirm: true })).json();
    expect(res).toEqual({ id: '11111111-2222-3333-4444-555555555555', summary: 'Base of Desert Kings', deleted: { Buildings: 12, PalBox: true }, archive: 'Archive/base.json' });
    const entry = ctx.services.audit.list({ category: 'server', limit: 1, offset: 0 }).entries[0]!;
    expect(entry.action).toBe('paldefender_base_deleted');
  });

  it('rejects bad input before it reaches PalDefender', async () => {
    const bad: Array<[string, Record<string, unknown>]> = [
      [`/players/${ANUBIS}/give/items`, { items: [{ itemId: 'Money', count: 0 }] }],
      [`/players/${ANUBIS}/give/items`, { items: [{ itemId: '../etc', count: 1 }] }],
      [`/players/${ANUBIS}/give/items`, { items: [] }],
      [`/players/${ANUBIS}/give/pals`, { pals: [{ palId: 'Anubis', level: 0 }] }],
      [`/players/${ANUBIS}/give/eggs`, { eggs: [{ eggId: 'Egg', palId: 'A', palTemplate: 'b.json' }] }],
      [`/players/${ANUBIS}/give/progression`, {}],
      [`/players/${ANUBIS}/give/progression`, { relics: { NotARelic: 1 } }],
      [`/players/${ANUBIS}/tech/learn`, { technology: ['All'] }],
      [`/players/${ANUBIS}/tech/wipe`, { technology: 'All' }],
      ['/summon/pal', { palId: 'A', palTemplate: 'b.json', x: 0, y: 0, z: 0 }],
      ['/summon/pal', { x: 0, y: 0, z: 0 }],
      ['/summon/npc', { npcId: 'N', x: 'far', y: 0, z: 0 }],
      ['/message', { sendType: 'Shout', message: 'hi', userIds: [ANUBIS] }],
    ];
    for (const [url, payload] of bad) expect((await post(admin, `/api/v1/paldefender${url}`, payload)).statusCode, url).toBe(400);
    expect(calls).toEqual([]);
  });

  it('passes PalDefender refusals on with its own explanation', async () => {
    failing.set('give', { status: 400, code: 'VALIDATION_FAILED' });
    const res = await post(admin, `/api/v1/paldefender/players/${ANUBIS}/give/items`, { items: [{ itemId: 'Nonsense', count: 1 }] });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({ code: 'paldefender_rejected', message: 'VALIDATION_FAILED happened' });
    // Nothing was granted, so nothing is audited as given.
    expect(ctx.services.audit.list({ category: 'players', limit: 5, offset: 0 }).entries.some((e) => e.action === 'paldefender_give_items')).toBe(false);
  });

  it('sends alerts, chat broadcasts and player messages with the right permissions', async () => {
    expect((await post(mod, '/api/v1/paldefender/alert', { message: 'Restart soon' })).statusCode).toBe(403);
    expect((await post(admin, '/api/v1/paldefender/alert', { message: 'Restart soon' })).statusCode).toBe(200);
    expect(body(calls.at(-1))).toEqual({ Message: 'Restart soon' });
    expect((await post(admin, '/api/v1/paldefender/broadcast', { message: 'Hello all' })).statusCode).toBe(200);
    expect(calls.at(-1)!.path).toBe('Broadcast');

    // Moderators can message players, one or several.
    expect((await post(mod, '/api/v1/paldefender/message', { sendType: 'PlayerLogImportant', message: 'Please move your base', userIds: [ANUBIS] })).json()).toEqual({ sent: 1 });
    expect(body(calls.at(-1))).toEqual({ SendType: 'PlayerLogImportant', Message: 'Please move your base', UserID: ANUBIS });
    await post(mod, '/api/v1/paldefender/message', { sendType: 'PlayerChat', message: 'hi', userIds: [ANUBIS, OLLIE] });
    expect(body(calls.at(-1))).toEqual({ SendType: 'PlayerChat', Message: 'hi', UserIDs: [ANUBIS, OLLIE] });

    // A token without the message-type permission is told which one.
    failing.set('SendPlayerMessage', { status: 403, code: 'MISSING_PERMISSION' });
    const denied = await post(mod, '/api/v1/paldefender/message', { sendType: 'PlayerGuildChat', message: 'x', userIds: [ANUBIS] });
    expect(denied.statusCode).toBe(502);
    expect(denied.json().error.message).toContain('REST.Messages.Send.GuildChat');
  });

  it('reloads the PalDefender config', async () => {
    expect((await post(admin, '/api/v1/paldefender/reload-config')).json()).toEqual({ ok: true });
    expect(calls.at(-1)).toMatchObject({ method: 'POST', path: 'ReloadConfig' });
  });

  it('is unavailable while the integration is switched off', async () => {
    await put(owner, '/api/v1/paldefender/settings', { enabled: false, host: '127.0.0.1', port, useTls: false });
    calls = [];
    expect((await get(mod, `/api/v1/paldefender/players/${ANUBIS}/items`)).statusCode).toBe(409);
    expect((await post(admin, '/api/v1/paldefender/reload-config')).statusCode).toBe(409);
    expect(calls).toEqual([]);
  });
});
