import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanBaseUrl } from '../src/services/palban/palban-service.js';
import { api, createTestApp, loginAs } from './helpers.js';

const KEY = 'net_secret_key';
const ANUBIS = 'steam_76561190000000002';
const LAMBALL = 'steam_76561190000000001';
const CHEATER = 'steam_76561190000000777';
const BANNED_ELSEWHERE = 'steam_76561190000000001';

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

let fake: Server;
let base: string;
let calls: Call[] = [];
let bans: Array<Record<string, unknown>> = [];
let networkReports: Record<string, number> = {};

const ban = (id: string, gameId: string, status = 'ACTIVE', extra: Record<string, unknown> = {}) => ({
  id,
  game_id: gameId,
  player_name: `Name of ${gameId}`,
  discord_id: null,
  reason: 'Cheating',
  category: 'CHEATING',
  status,
  ban_date: '2026-09-01T00:00:00.000Z',
  expires_at: null,
  unban_date: null,
  updated_at: `2026-09-0${bans.length + 1}T00:00:00.000Z`,
  ...extra,
});

beforeAll(async () => {
  fake = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const url = new URL(req.url ?? '', 'http://x');
      const send = (status: number, body: unknown) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
      if (req.headers.authorization !== `Bearer ${KEY}`) return send(401, { error: 'Invalid key' });
      calls.push({ method: req.method ?? '', path: url.pathname + url.search, body: raw ? (JSON.parse(raw) as Record<string, unknown>) : null });
      if (url.pathname === '/api/v1/integrations/status') {
        return send(200, { ok: true, integration: { name: 'PalOps' }, server: { id: 'srv-1', name: 'Desert Kings' }, scopes: ['READ_SERVER', 'READ_PLAYERS', 'READ_BANLIST', 'WRITE_EVENTS'] });
      }
      if (url.pathname === '/api/v1/servers/srv-1/banlist') {
        // Two per page, so paging is exercised.
        const cursor = Number(url.searchParams.get('cursor') ?? 0);
        const page = bans.slice(cursor, cursor + 2);
        const end = cursor + page.length;
        return send(200, { server_id: 'srv-1', bans: page, next_cursor: end < bans.length ? String(end) : null, sync_cursor: String(end) });
      }
      if (url.pathname.startsWith('/api/v1/players/')) {
        const id = decodeURIComponent(url.pathname.split('/').pop()!);
        const active = networkReports[id] ?? 0;
        return send(200, {
          game_id: id,
          player_name: null,
          linked_discord_id: null,
          local_ban_status: bans.some((b) => b.game_id === id && b.status === 'ACTIVE') ? 'BANNED' : 'NOT_BANNED',
          local_bans: [],
          network: { servers_reporting: active ? 2 : 0, report_count: active, active_report_count: active, reports: active ? [{ server: 'Other Realm', reason: 'Duping', status: 'ACTIVE', ban_date: '2026-08-01T00:00:00Z', expires_at: null }] : [] },
          recent_anticheat_detections: [],
        });
      }
      if (url.pathname === '/api/v1/integrations/events/batch') return send(202, { accepted: (JSON.parse(raw) as { events: unknown[] }).events.length, duplicates: 0, failed: 0, rejected: 0 });
      if (url.pathname === '/api/v1/integrations/logs') {
        const n = (JSON.parse(raw) as { lines: unknown[] }).lines.length;
        return send(202, { lines: n, skipped: 0, accepted: n, duplicates: 0, failed: 0, rejected: 0, errors: [] });
      }
      if (url.pathname === '/api/v1/integrations/heartbeat') return send(200, { ok: true });
      return send(404, { error: 'no such endpoint' });
    });
  });
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => fake.close(() => r())));

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let owner: string;

beforeEach(async () => {
  calls = [];
  bans = [ban('b1', CHEATER), ban('b2', 'steam_76561190000000888'), ban('b3', 'steam_76561190000000999', 'REVOKED')];
  networkReports = {};
  ctx = await createTestApp();
  ctx.services.servers.savePrimary({ name: 'Dev', adapter: 'mock', host: '', port: 8212, username: 'admin' });
  await ctx.services.players.refreshOnline();
  owner = await loginAs(ctx.app, ctx.services, 'owner');
});

const put = (cookie: string, payload: Record<string, unknown>) => api(ctx.app, { method: 'PUT', url: '/api/v1/palban/settings', cookie, payload });
const post = (cookie: string, url: string, payload: Record<string, unknown> = {}) => api(ctx.app, { method: 'POST', url, cookie, payload });
const get = (cookie: string, url: string) => api(ctx.app, { method: 'GET', url, cookie });
const enable = (extra: Record<string, unknown> = {}) => put(owner, { enabled: true, baseUrl: base, key: KEY, sendEvents: true, checkJoins: true, sendLogs: false, sendLogAddresses: false, ...extra });

describe('settings', () => {
  it('is owner-only, never returns the key, and needs a key to switch on', async () => {
    const admin = await loginAs(ctx.app, ctx.services, 'admin');
    expect((await get(admin, '/api/v1/palban/settings')).statusCode).toBe(403);
    expect((await put(owner, { enabled: true, baseUrl: base })).json().error.code).toBe('key_required');
    expect((await put(owner, { enabled: false, baseUrl: 'ftp://nope' })).statusCode).toBe(400);
    const res = await enable();
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(KEY);
    expect(res.json().settings).toMatchObject({ enabled: true, baseUrl: base, hasKey: true });
    expect(JSON.stringify(ctx.services.audit.list({ category: 'server', limit: 5, offset: 0 }).entries)).not.toContain(KEY);
    expect(cleanBaseUrl('https://user:pw@palban.net')).toBeNull();
    expect(cleanBaseUrl('https://palban.net/')).toBe('https://palban.net');
  });

  it('checks a key: which server it is for and what it may do', async () => {
    const res = (await post(owner, '/api/v1/palban/test', { baseUrl: base, key: KEY })).json();
    expect(res).toMatchObject({ serverId: 'srv-1', serverName: 'Desert Kings', missingScopes: [] });
    const bad = await post(owner, '/api/v1/palban/test', { baseUrl: base, key: 'wrong' });
    expect(bad.statusCode).toBe(502);
    expect(bad.json().error.code).toBe('unauthorized');
  });
});

describe('banlist', () => {
  it('mirrors the banlist across pages and compares it with the game', async () => {
    await enable();
    const res = (await post(owner, '/api/v1/palban/sync')).json();
    expect(res.changed).toBe(3);
    const list = (await get(owner, '/api/v1/palban/bans')).json();
    expect(list.bans.map((b: { gameId: string; active: boolean }) => [b.gameId, b.active])).toEqual([
      [CHEATER, true],
      ['steam_76561190000000888', true],
      ['steam_76561190000000999', false],
    ]);
    expect(list.bans[0]).toMatchObject({ inGame: false, applied: false });
    expect(list.status).toMatchObject({ enabled: true, serverName: 'Desert Kings', notInGame: 2, bans: { total: 3, active: 2 } });
  });

  it('bans in the game with one click, and lists what is banned only here', async () => {
    await enable();
    await post(owner, '/api/v1/palban/sync');
    expect((await post(owner, '/api/v1/palban/bans/b3/apply')).json().error.code).toBe('not_active');
    expect((await post(owner, '/api/v1/palban/bans/b1/apply')).statusCode).toBe(200);
    expect(ctx.services.moderation.isBanned(CHEATER)).toBe(true);
    const list = (await get(owner, '/api/v1/palban/bans')).json();
    expect(list.bans[0]).toMatchObject({ gameId: CHEATER, inGame: true, applied: true });
    expect(ctx.services.moderation.history(CHEATER)[0]).toMatchObject({ action: 'ban', reason: 'PalBan Network: Cheating' });

    await post(owner, `/api/v1/players/${ANUBIS}/ban`, { reason: 'Griefing' });
    expect((await get(owner, '/api/v1/palban/bans')).json().onlyHere.map((b: { userId: string }) => b.userId)).toEqual([ANUBIS]);
  });

  it('syncs only what changed, and never bans or unbans by itself', async () => {
    await enable();
    await post(owner, '/api/v1/palban/sync');
    // Active bans on PalBan are not banned in the game until a person says so.
    expect(ctx.services.moderation.isBanned(CHEATER)).toBe(false);
    expect(ctx.services.moderation.isBanned('steam_76561190000000888')).toBe(false);
    await post(owner, '/api/v1/palban/bans/b1/apply');
    expect(ctx.services.moderation.isBanned(CHEATER)).toBe(true);

    calls = [];
    // PalBan lists a changed ban again, after the ones the sync has already seen.
    bans.push(ban('b1', CHEATER, 'REVOKED', { unban_date: '2026-09-10T00:00:00.000Z', updated_at: '2026-09-10T00:00:00.000Z' }));
    bans.push(ban('b4', 'steam_76561190000000444'));
    const changed = (await post(owner, '/api/v1/palban/sync')).json().changed;
    expect(changed).toBe(2);
    expect(calls.some((c) => c.path.includes('cursor='))).toBe(true);
    // Lifted on PalBan, still banned in the game: the panel shows it and leaves the choice to the team.
    expect(ctx.services.moderation.isBanned(CHEATER)).toBe(true);
    expect(ctx.services.moderation.isBanned('steam_76561190000000444')).toBe(false);
    const list = (await get(owner, '/api/v1/palban/bans')).json().bans;
    expect(list.find((b: { id: string }) => b.id === 'b1')).toMatchObject({ active: false, inGame: true, applied: true });
  });

  it('reports a rejected key instead of throwing, and keeps the error on the status', async () => {
    await put(owner, { enabled: true, baseUrl: base, key: 'wrong', sendEvents: false, checkJoins: false });
    const res = await post(owner, '/api/v1/palban/sync');
    expect(res.statusCode).toBe(502);
    expect((await get(owner, '/api/v1/palban/status')).json().error).toContain('rejected the key');
  });

  it('answers "not set up" until it is enabled', async () => {
    expect((await get(owner, '/api/v1/palban/bans')).json()).toMatchObject({ enabled: false, bans: [] });
    expect((await post(owner, '/api/v1/palban/sync')).statusCode).toBe(409);
  });
});

describe('players on the network', () => {
  it('looks a player up, for moderators and up', async () => {
    await enable();
    networkReports[LAMBALL] = 2;
    const mod = await loginAs(ctx.app, ctx.services, 'moderator');
    const res = (await get(mod, `/api/v1/palban/players/${LAMBALL}`)).json();
    expect(res.player.network).toMatchObject({ activeReportCount: 2, serversReporting: 2 });
    expect(res.player.network.reports[0]).toMatchObject({ server: 'Other Realm', reason: 'Duping' });
    const viewer = await loginAs(ctx.app, ctx.services, 'viewer');
    expect((await get(viewer, `/api/v1/palban/players/${LAMBALL}`)).statusCode).toBe(403);
  });

  it('flags a player who joins with active bans elsewhere, once, and tells listeners', async () => {
    await enable({ sendEvents: false });
    networkReports[LAMBALL] = 1;
    const flags: Array<{ userId: string; activeReports: number }> = [];
    ctx.services.palban.onFlag((f) => flags.push(f));
    ctx.services.players.markAllOffline();
    await ctx.services.players.refreshOnline();
    await vi.waitFor(() => expect(flags).toHaveLength(1));
    expect(flags[0]).toMatchObject({ userId: LAMBALL, activeReports: 1 });
    expect(ctx.services.audit.list({ category: 'players', limit: 10, offset: 0 }).entries.map((e) => e.action)).toContain('palban_flag');
    // Another look at the same list doesn't ask or flag again.
    const asked = calls.length;
    ctx.services.players.markAllOffline();
    await ctx.services.players.refreshOnline();
    await new Promise((r) => setTimeout(r, 20));
    expect(flags).toHaveLength(1);
    expect(calls.length).toBe(asked);
  });
});

describe('events', () => {
  it('sends joins, leaves and bans made here, never an address', async () => {
    await enable({ checkJoins: false });
    ctx.services.palworld.mock.join({ name: 'Newcomer', userId: 'steam_76561190000000123', ip: '203.0.113.99' });
    ctx.services.players.markAllOffline();
    await ctx.services.players.refreshOnline();
    ctx.services.palworld.mock.join({ name: 'Second', userId: 'steam_76561190000000124', ip: '203.0.113.98' });
    ctx.services.players.markAllOffline();
    await ctx.services.players.refreshOnline();
    await post(owner, `/api/v1/players/${ANUBIS}/ban`, { reason: 'Griefing' });
    await ctx.services.palban.flush();
    const sent = calls.filter((c) => c.path === '/api/v1/integrations/events/batch').flatMap((c) => (c.body as { events: Array<{ event_type: string; player: { game_id: string }; event_id: string }> }).events);
    expect(sent.map((e) => e.event_type)).toContain('PLAYER_JOIN');
    expect(sent.find((e) => e.event_type === 'BAN_CREATED')).toMatchObject({ player: { game_id: ANUBIS, name: 'Anubis' } });
    expect(new Set(sent.map((e) => e.event_id)).size).toBe(sent.length);
    expect(JSON.stringify(calls)).not.toContain('203.0.113');
    expect(ctx.services.palban.status().queued).toBe(0);
  });

  it('keeps events queued when PalBan is unreachable', async () => {
    await put(owner, { enabled: true, baseUrl: 'http://127.0.0.1:1', key: KEY, sendEvents: true, checkJoins: false });
    await post(owner, `/api/v1/players/${ANUBIS}/ban`, { reason: 'Griefing' });
    expect(ctx.services.palban.status().queued).toBe(1);
    await expect(ctx.services.palban.flush()).rejects.toThrow();
    expect(ctx.services.palban.status().queued).toBe(1);
  });
});

describe('PalDefender log lines', () => {
  const CHEATER_LINE = "[12:34:00][warning] 'Fanta' (UserId=steam_76561199142243524, IP=85.153.119.170) may be a cheater! Reason: Stamina cheat suspicion: performed 'Roll' while IsSPOverheat stayed true for 8 more movement ticks.. Not taking any actions, since this requires human judgement.";
  const CHAT_LINE = '[12:35:00][info] [Chat] Fanta: my address is 85.153.119.170';
  const logCalls = () => calls.filter((c) => c.path === '/api/v1/integrations/logs').flatMap((c) => (c.body as { lines: Array<{ line: string; at: string }> }).lines);
  const feed = () => {
    ctx.services.console.add('paldefender', CHEATER_LINE);
    ctx.services.console.add('paldefender', CHAT_LINE);
    ctx.services.console.add('game', CHEATER_LINE);
    ctx.services.console.flush();
  };

  it('sends nothing unless an owner turned it on', async () => {
    await enable();
    feed();
    expect(ctx.services.palban.status().logsQueued).toBe(0);
    await ctx.services.palban.flushLogs();
    expect(logCalls()).toEqual([]);
  });

  it('sends only the cheater lines of the PalDefender log, with the time it saw them and no address', async () => {
    await enable({ sendLogs: true });
    feed();
    expect(ctx.services.palban.status().logsQueued).toBe(1);
    await ctx.services.palban.flushLogs();
    const sent = logCalls();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.line).toContain("'Fanta' (UserId=steam_76561199142243524) may be a cheater!");
    expect(sent[0]!.line).not.toContain('85.153.119.170');
    expect(Date.parse(sent[0]!.at)).not.toBeNaN();
    expect(JSON.stringify(calls)).not.toContain('my address is');
    expect(calls.find((c) => c.path === '/api/v1/integrations/logs')!.body).toMatchObject({ source: 'PalOps' });
    expect(ctx.services.palban.status().logsQueued).toBe(0);
  });

  it('keeps addresses only when the owner allows it', async () => {
    await enable({ sendLogs: true, sendLogAddresses: true });
    feed();
    await ctx.services.palban.flushLogs();
    expect(logCalls()[0]!.line).toContain('IP=85.153.119.170');
  });

  it('keeps the lines queued when PalBan is unreachable', async () => {
    await put(owner, { enabled: true, baseUrl: 'http://127.0.0.1:1', key: KEY, sendEvents: false, checkJoins: false, sendLogs: true, sendLogAddresses: false });
    feed();
    await expect(ctx.services.palban.flushLogs()).rejects.toThrow();
    expect(ctx.services.palban.status().logsQueued).toBe(1);
  });
});

describe('export for PalBan', () => {
  it('exports the game’s bans in the columns PalBan imports, addresses only with players.ip', async () => {
    await post(owner, `/api/v1/players/${ANUBIS}/ban`, { reason: 'Griefing, again', banAddress: true });
    const csv = (await get(owner, '/api/v1/palban/export.csv')).body.replace('﻿', '');
    const [header, row] = csv.split('\r\n');
    expect(header).toBe('game_id,player_name,discord_username,discord_id,ip,ban_date,reason,status');
    expect(row).toContain(`${ANUBIS},Anubis,,,198.51.100.23,`);
    expect(row).toContain('"Griefing, again",ACTIVE');
    const admin = await loginAs(ctx.app, ctx.services, 'admin');
    expect((await get(admin, '/api/v1/palban/export.csv')).body).toContain('ip');
    const mod = await loginAs(ctx.app, ctx.services, 'moderator');
    expect((await get(mod, '/api/v1/palban/export.csv')).statusCode).toBe(403);
  });
});
