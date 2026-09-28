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

    const res = (await post(admin, `/api/v1/players/${ANUBIS}/ban`, { reason: 'x', banIp: true })).json();
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
    const res = (await post(admin, `/api/v1/players/${ANUBIS}/ban`, { reason: 'Griefing', banIp: true })).json();
    expect(res.paldefender).toEqual({ ok: true, message: null });
    expect(res.ipBan.ip).toBe('198.51.100.23');
    expect(calls.find((c) => c.path === `ban/${ANUBIS}`)).toMatchObject({ method: 'POST', body: { Reason: 'Griefing', IP: true } });
  });

  it('does not ask PalDefender for an address the panel refused to ban', async () => {
    ctx.services.players.recordIps(ctx.services.servers.getPrimary()!.id, [{ userId: 'steam_lan', name: 'Lan', ip: '192.168.1.5' }]);
    const res = (await post(admin, '/api/v1/players/steam_lan/ban', { banIp: true })).json();
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

    await post(admin, `/api/v1/players/${ANUBIS}/ban`, { banIp: true });
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

  it('records addresses of offline players and enforces banned addresses on them', async () => {
    const world = ctx.services.moderation;
    await world.banIp({ userId: null, username: 'test' }, '192.0.2.77', 'Ban evasion');
    calls = [];
    expect(await ctx.services.paldefender.syncPlayers()).toBe(3);
    const ips = ctx.services.players.ipsOf('steam_ollie');
    expect(ips.map((i) => i.ip)).toEqual(['192.0.2.77']);
    // The offline player on a banned address is banned when PalDefender reports them.
    await vi.waitFor(() => expect(world.isBanned('steam_ollie')).toBe(true));
    expect(ctx.services.paldefender.status()).toMatchObject({ enabled: true, version: '1.7.2.9', error: null, lastSyncAt: expect.any(String) });
  });

  it('reports a sync failure in the status instead of throwing on the panel', async () => {
    failing.set('players', { status: 500, code: 'REQUEST_FAILED' });
    await expect(ctx.services.paldefender.syncPlayers()).rejects.toThrow();
    expect(ctx.services.paldefender.status().error).toContain('REQUEST_FAILED');
  });
});
