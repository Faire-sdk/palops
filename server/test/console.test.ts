import { appendFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, utimesSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanMessage, ConsoleService, guessLevel } from '../src/services/console/console-service.js';
import { SecretBox } from '../src/utils/crypto.js';
import { api, createTestApp, loginAs } from './helpers.js';

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let dir: string;

beforeEach(async () => {
  ctx = await createTestApp();
  dir = mkdtempSync(join(tmpdir(), 'palops-console-'));
});
afterEach(() => {
  ctx.services.console.stopTail();
  rmSync(dir, { recursive: true, force: true });
});

const messages = (source?: 'game' | 'paldefender' | 'panel') =>
  ctx.services.console.lines({ limit: 1000, sources: source ? [source] : undefined }).map((l) => l.message);
const get = (cookie: string, url: string) => api(ctx.app, { method: 'GET', url, cookie });
const put = (cookie: string, url: string, payload: Record<string, unknown>) => api(ctx.app, { method: 'PUT', url, cookie, payload });

describe('console lines', () => {
  it('strips colour codes and control characters, and guesses a level', () => {
    expect(cleanMessage('\u001b[31mred\u001b[0m text\u0007\u0000')).toBe('red text');
    expect(cleanMessage('a'.repeat(5000))).toHaveLength(2000);
    expect(guessLevel('[Error] something broke')).toBe('error');
    expect(guessLevel('LogNet: Warning: slow')).toBe('warn');
    expect(guessLevel('Player Anubis joined')).toBe('info');
  });

  it('stores, filters and searches lines, oldest first', () => {
    const c = ctx.services.console;
    c.add('game', 'first line');
    c.add('game', '[Error] disk 100% full');
    c.add('paldefender', 'kick issued');
    c.add('panel', 'a_b warning: careful', 'warn');
    c.flush();
    expect(messages()).toEqual(['first line', '[Error] disk 100% full', 'kick issued', 'a_b warning: careful']);
    expect(messages('game')).toEqual(['first line', '[Error] disk 100% full']);
    expect(c.lines({ limit: 10, minLevel: 'warn' }).map((l) => l.message)).toEqual(['[Error] disk 100% full', 'a_b warning: careful']);
    expect(c.lines({ limit: 10, minLevel: 'error' })).toHaveLength(1);
    // % and _ are searched literally, not as wildcards.
    expect(c.lines({ limit: 10, search: '100%' })).toHaveLength(1);
    expect(c.lines({ limit: 10, search: 'a_b' })).toHaveLength(1);
    expect(c.lines({ limit: 10, search: 'a%b' })).toHaveLength(0);
    // Following forward, and the newest N.
    const all = c.lines({ limit: 10 });
    expect(c.lines({ limit: 2 }).map((l) => l.message)).toEqual(['kick issued', 'a_b warning: careful']);
    expect(c.lines({ afterId: all[0]!.id - 1, limit: 2 }).map((l) => l.message)).toEqual(['first line', '[Error] disk 100% full']);
    expect(c.lines({ afterId: all[1]!.id, limit: 10 }).map((l) => l.message)).toEqual(['kick issued', 'a_b warning: careful']);
  });

  it('tells live viewers about new lines, in batches', () => {
    const seen: string[] = [];
    const stop = ctx.services.console.subscribe((lines) => seen.push(...lines.map((l) => l.message)));
    ctx.services.console.add('game', 'one');
    ctx.services.console.add('game', 'two');
    expect(seen).toEqual([]);
    ctx.services.console.flush();
    expect(seen).toEqual(['one', 'two']);
    stop();
    ctx.services.console.add('game', 'three');
    ctx.services.console.flush();
    expect(seen).toEqual(['one', 'two']);
  });

  it('keeps a week and at most 100,000 lines', () => {
    const c = ctx.services.console;
    const old = new Date(Date.now() - 8 * 24 * 3600 * 1000);
    c.add('game', 'ancient', 'info', old);
    c.add('game', 'recent');
    c.prune();
    expect(messages()).toEqual(['recent']);
  });
});

describe('tailing log files', () => {
  const start = (path: string, source: 'game' | 'paldefender' = 'game') => {
    ctx.services.console.save({ tailEnabled: true, gameLogPath: source === 'game' ? path : null, paldefenderLogPath: source === 'paldefender' ? path : null });
    ctx.services.console.pollTail();
  };
  const poll = () => ctx.services.console.pollTail();

  it('shows the end of a file first, then only what is appended', () => {
    const file = join(dir, 'Pal.log');
    writeFileSync(file, Array.from({ length: 300 }, (_, i) => `old ${i}`).join('\n') + '\n');
    start(file);
    // First sight: only the most recent lines, none cut in half.
    const first = messages('game');
    expect(first.length).toBeLessThanOrEqual(100);
    expect(first.at(-1)).toBe('old 299');
    expect(first.every((m) => /^old \d+$/.test(m))).toBe(true);

    appendFileSync(file, 'new 1\nnew 2\n');
    poll();
    poll();
    expect(messages('game').slice(-2)).toEqual(['new 1', 'new 2']);
    expect(messages('game').filter((m) => m === 'new 1')).toHaveLength(1);
  });

  it('holds a half-written line until it is finished, and handles Windows line endings', () => {
    const file = join(dir, 'Pal.log');
    writeFileSync(file, 'ready\r\n');
    start(file);
    appendFileSync(file, 'half a li');
    poll();
    expect(messages('game')).toEqual(['ready']);
    appendFileSync(file, 'ne\r\nnext\r\n');
    poll();
    expect(messages('game')).toEqual(['ready', 'half a line', 'next']);
  });

  it('does not corrupt a multi-byte character split between two reads', () => {
    const file = join(dir, 'Pal.log');
    writeFileSync(file, '');
    start(file);
    const bytes = Buffer.from('プレイヤー joined\n');
    appendFileSync(file, bytes.subarray(0, 4));
    poll();
    appendFileSync(file, bytes.subarray(4));
    poll();
    expect(messages('game')).toEqual(['プレイヤー joined']);
  });

  it('starts over when the file is rotated or truncated', () => {
    const file = join(dir, 'Pal.log');
    writeFileSync(file, 'a long first line of the old log\n');
    start(file);
    truncateSync(file, 0);
    writeFileSync(file, 'fresh\n');
    poll();
    expect(messages('game').at(-1)).toBe('fresh');
  });

  it('remembers where it got to across restarts', () => {
    const file = join(dir, 'Pal.log');
    writeFileSync(file, 'one\ntwo\n');
    start(file);
    expect(messages('game')).toEqual(['one', 'two']);
    ctx.services.console.stopTail();
    appendFileSync(file, 'three\n');
    // A new service over the same database, as after a restart.
    const again = new ConsoleService(ctx.services.db, [], new SecretBox('a'.repeat(40), 'test'));
    again.restartTail();
    again.pollTail();
    again.stopTail();
    expect(messages('game')).toEqual(['one', 'two', 'three']);
  });

  it('follows the recently changed log files in a folder, and ignores other files', () => {
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'Logs-1.log'), 'from log one\n');
    writeFileSync(join(dir, 'sub', 'chat.txt'), 'from nested chat\n');
    writeFileSync(join(dir, 'secrets.env'), 'PASSWORD=hunter2\n');
    writeFileSync(join(dir, 'data.json'), '{"x":1}\n');
    writeFileSync(join(dir, '.hidden.log'), 'hidden\n');
    const stale = join(dir, 'ancient.log');
    writeFileSync(stale, 'stale\n');
    utimesSync(stale, new Date(Date.now() - 3 * 24 * 3600 * 1000), new Date(Date.now() - 3 * 24 * 3600 * 1000));
    start(dir, 'paldefender');
    expect(messages('paldefender').sort()).toEqual(['from log one', 'from nested chat']);
    expect(ctx.services.console.tailStatus()[0]).toMatchObject({ source: 'paldefender', state: 'watching', files: 2 });

    // A file that appears later (a new day's log) is picked up on a rescan.
    writeFileSync(join(dir, 'Logs-2.log'), 'from log two\n');
    for (let i = 0; i < 6; i++) poll();
    expect(messages('paldefender')).toContain('from log two');
  });

  it('is off until switched on, and reports a location that has disappeared', () => {
    const file = join(dir, 'Pal.log');
    writeFileSync(file, 'x\n');
    ctx.services.console.save({ tailEnabled: false, gameLogPath: file, paldefenderLogPath: null });
    poll();
    expect(messages('game')).toEqual([]);
    expect(ctx.services.console.tailStatus()).toEqual([]);

    ctx.services.console.save({ tailEnabled: true, gameLogPath: file, paldefenderLogPath: null });
    rmSync(file);
    poll();
    expect(ctx.services.console.tailStatus()[0]).toMatchObject({ state: 'missing' });
  });
});

describe('log path safety', () => {
  const check = (path: string) => ctx.services.console.check({ gameLogPath: path, paldefenderLogPath: null })[0]!;

  it('accepts a log file or a folder and refuses everything else', () => {
    writeFileSync(join(dir, 'Pal.log'), 'x');
    writeFileSync(join(dir, '.env'), 'SECRET=1');
    writeFileSync(join(dir, 'notes.json'), '{}');
    writeFileSync(join(dir, '.hidden.log'), 'x');
    expect(check(join(dir, 'Pal.log'))).toMatchObject({ ok: true, kind: 'file' });
    expect(check(dir)).toMatchObject({ ok: true, kind: 'directory' });
    expect(check('relative/Pal.log').ok).toBe(false);
    expect(check(join(dir, 'missing.log')).message).toContain('doesn’t exist');
    expect(check(join(dir, '.env')).ok).toBe(false);
    expect(check(join(dir, 'notes.json')).ok).toBe(false);
    expect(check(join(dir, '.hidden.log')).ok).toBe(false);
  });

  it('will not read the panel’s own data folder, or a link out of a log folder to it', () => {
    const data = join(dir, 'data');
    mkdirSync(data);
    writeFileSync(join(data, 'palops.log'), 'x');
    const guarded = new ConsoleService(ctx.services.db, [data], new SecretBox('a'.repeat(40), 'test'));
    const attempt = (p: string) => guarded.check({ gameLogPath: p, paldefenderLogPath: null })[0]!;
    expect(attempt(data).ok).toBe(false);
    expect(attempt(join(data, 'palops.log')).ok).toBe(false);
    // A folder that contains the data folder would expose it too.
    expect(attempt(dir).ok).toBe(false);
    const link = join(tmpdir(), `palops-link-${process.pid}.log`);
    try {
      symlinkSync(join(data, 'palops.log'), link);
      expect(attempt(link).ok).toBe(false);
    } catch {
      // Symlinks need extra rights on some systems; the check above is the point.
    } finally {
      rmSync(link, { force: true });
    }
  });
});

describe('events from the panel', () => {
  it('mirrors admin actions but not sign-ins', () => {
    ctx.services.audit.record({ userId: null, username: 'owner' }, { category: 'players', action: 'kick', target: 'Anubis (steam_1)', details: { reason: 'secret reason' } });
    ctx.services.audit.record({ userId: null, username: 'owner' }, { category: 'auth', action: 'login' });
    expect(messages('panel')).toEqual(['owner: kick · Anubis (steam_1)']);
  });

  it('announces joins and leaves, but not the players already on when the panel starts', () => {
    const player = (name: string, userId: string) => ({ name, accountName: name, playerId: userId, userId, ip: null, ping: 1, level: 1, location: null, buildingCount: null, guild: null });
    const serverId = ctx.services.servers.savePrimary({ name: 'Dev', adapter: 'mock', host: '', port: 8212, username: 'admin' }).id;
    const players = ctx.services.players;
    players.record(serverId, [player('Anubis', 'steam_1')]);
    expect(messages('panel')).toEqual([]);
    players.record(serverId, [player('Anubis', 'steam_1'), player('Lamball', 'steam_2')]);
    players.record(serverId, [player('Lamball', 'steam_2')]);
    expect(messages('panel')).toEqual(['Lamball joined', 'Anubis left']);
  });

  it('shows cheat signals as warnings', () => {
    ctx.services.servers.savePrimary({ name: 'Dev', adapter: 'mock', host: '', port: 8212, username: 'admin' });
    const shared = (userId: string, name: string) => ({
      instanceId: `p-${userId}`, unitType: 'Player' as const, name, className: null, trainerInstanceId: null, userId, ip: '10.9.9.9', level: 5, hp: 1, maxHp: 1,
      guildId: null, guildName: null, location: { x: 0, y: 0, z: 0 },
    });
    ctx.services.world.ingest({ serverTime: null, fps: 60, averageFps: 60, palBoxes: [], characters: [shared('steam_1', 'A'), shared('steam_2', 'B')] });
    const warn = ctx.services.console.lines({ limit: 10, minLevel: 'warn' });
    expect(warn.length).toBe(2);
    expect(warn[0]).toMatchObject({ source: 'panel', level: 'warn' });
  });
});

describe('console API', () => {
  it('needs console.view to read', async () => {
    ctx.services.console.add('game', 'hello');
    const admin = await loginAs(ctx.app, ctx.services, 'admin');
    expect((await get(admin, '/api/v1/console/lines')).json().lines.map((l: { message: string }) => l.message)).toEqual(['hello']);
    for (const role of ['moderator', 'viewer'] as const) {
      const cookie = await loginAs(ctx.app, ctx.services, role);
      expect((await get(cookie, '/api/v1/console/lines')).statusCode).toBe(403);
      expect((await get(cookie, '/api/v1/console/stream')).statusCode).toBe(403);
    }
    expect((await api(ctx.app, { method: 'GET', url: '/api/v1/console/lines' })).statusCode).toBe(401);
  });

  it('filters lines by source, level and text', async () => {
    const c = ctx.services.console;
    c.add('game', 'boot');
    c.add('paldefender', 'Warning: odd item', 'warn');
    c.add('game', 'Error: crash');
    const admin = await loginAs(ctx.app, ctx.services, 'admin');
    const q = async (query: string) => (await get(admin, `/api/v1/console/lines?${query}`)).json().lines.map((l: { message: string }) => l.message);
    expect(await q('sources=paldefender')).toEqual(['Warning: odd item']);
    expect(await q('sources=game,nonsense')).toEqual(['boot', 'Error: crash']);
    expect(await q('level=error')).toEqual(['Error: crash']);
    expect(await q('q=item')).toEqual(['Warning: odd item']);
    expect(await q('limit=1')).toEqual(['Error: crash']);
    expect((await get(admin, '/api/v1/console/lines?limit=5000')).statusCode).toBe(400);
  });

  it('lets only owners choose the log locations, checks them, and audits the change', async () => {
    writeFileSync(join(dir, 'Pal.log'), 'x\n');
    const body = { tailEnabled: true, gameLogPath: join(dir, 'Pal.log'), paldefenderLogPath: null };
    const admin = await loginAs(ctx.app, ctx.services, 'admin');
    expect((await get(admin, '/api/v1/console/settings')).statusCode).toBe(403);
    expect((await put(admin, '/api/v1/console/settings', body)).statusCode).toBe(403);

    const owner = await loginAs(ctx.app, ctx.services, 'owner');
    const tested = (await api(ctx.app, { method: 'POST', url: '/api/v1/console/settings/test', cookie: owner, payload: { gameLogPath: join(dir, 'nope.log'), paldefenderLogPath: dir } })).json();
    expect(tested.checks).toMatchObject([{ source: 'game', ok: false }, { source: 'paldefender', ok: true, kind: 'directory' }]);

    const bad = await put(owner, '/api/v1/console/settings', { ...body, gameLogPath: join(dir, 'nope.log') });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.message).toContain('Game log');
    expect((await put(owner, '/api/v1/console/settings', { tailEnabled: true, gameLogPath: null, paldefenderLogPath: null })).statusCode).toBe(400);

    const saved = await put(owner, '/api/v1/console/settings', body);
    expect(saved.json().settings).toMatchObject({ tailEnabled: true, gameLogPath: body.gameLogPath });
    expect(ctx.services.audit.list({ category: 'console', limit: 1, offset: 0 }).entries[0]).toMatchObject({ action: 'settings_updated' });
    ctx.services.console.pollTail();
    expect((await get(admin, '/api/v1/console/lines?sources=game')).json().lines.map((l: { message: string }) => l.message)).toEqual(['x']);
  });

  it('streams new lines live, after replaying what was missed', async () => {
    ctx.services.console.add('game', 'before');
    ctx.services.console.flush();
    const [firstLine] = ctx.services.console.lines({ limit: 1 });
    const admin = await loginAs(ctx.app, ctx.services, 'admin');
    await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    const port = (ctx.app.server.address() as AddressInfo).port;
    ctx.services.console.add('game', 'missed while away');
    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/console/stream?after=${firstLine!.id}`, { headers: { cookie: admin }, signal: controller.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const readUntil = async (needle: string) => {
      while (!text.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
    };
    await readUntil('missed while away');
    ctx.services.console.add('game', 'arrived live');
    ctx.services.console.flush();
    await readUntil('arrived live');
    expect(text).toContain('event: line');
    expect(text).not.toContain('"message":"before"');
    expect(text.indexOf('missed while away')).toBeLessThan(text.indexOf('arrived live'));
    controller.abort();
    await ctx.app.close();
  });
});

describe('PalServerLogger websocket', () => {
  const TOKEN = 'logger-secret-123';
  let wss: WebSocketServer | undefined;
  let port = 0;
  let headers: Array<string | undefined> = [];

  const serve = async (listenPort = 0) => {
    headers = [];
    wss = new WebSocketServer({
      host: '127.0.0.1',
      port: listenPort,
      // Like the DLL: connections without the right secret are rejected.
      verifyClient: (info, done) => {
        headers.push(info.req.headers.authorization);
        if (info.req.headers.authorization === `Bearer ${TOKEN}`) done(true);
        else done(false, 401, 'Unauthorized');
      },
    });
    await new Promise<void>((r) => wss!.once('listening', () => r()));
    port = (wss.address() as AddressInfo).port;
  };
  const close = async () => {
    if (!wss) return;
    for (const c of wss.clients) c.terminate();
    await new Promise<void>((r) => wss!.close(() => r()));
    wss = undefined;
  };
  afterEach(close);

  const settings = (token: string | undefined = TOKEN, enabled = true) => ({ tailEnabled: false, gameLogPath: null, paldefenderLogPath: null, logger: { enabled, host: '127.0.0.1', port, tls: false, token } });
  const status = () => ctx.services.console.loggerStatus();

  it('shows the log messages it sends, and ignores everything else', async () => {
    await serve();
    ctx.services.console.save(settings());
    await vi.waitFor(() => expect(status().state).toBe('connected'));
    expect(headers).toEqual([`Bearer ${TOKEN}`]);
    const [client] = [...wss!.clients];
    client!.send(JSON.stringify({ type: 'log', message: '[2026-09-12 12:00:00] Server started' }));
    client!.send(JSON.stringify({ type: 'other', message: 'ignored' }));
    client!.send('not json');
    client!.send(JSON.stringify({ type: 'log', message: 42 }));
    client!.send(JSON.stringify({ type: 'log', message: '\u001b[31m[Error] boom\u001b[0m' }));
    await vi.waitFor(() => expect(messages('game')).toHaveLength(2));
    expect(messages('game')).toEqual(['[2026-09-12 12:00:00] Server started', '[Error] boom']);
    expect(ctx.services.console.lines({ limit: 5, minLevel: 'error' })).toHaveLength(1);
    expect(status().lastMessageAt).not.toBeNull();
  });

  it('explains a rejected token and keeps trying', async () => {
    await serve();
    ctx.services.console.save(settings('wrong-token'));
    await vi.waitFor(() => expect(status().state).toBe('error'));
    expect(status().message).toContain('rejected the token');
  });

  it('reconnects by itself when the server comes back', async () => {
    await serve();
    ctx.services.console.save(settings());
    await vi.waitFor(() => expect(status().state).toBe('connected'));
    const wasPort = port;
    await close();
    await vi.waitFor(() => expect(status().state).toBe('error'), { timeout: 3000 });
    await serve(wasPort);
    await vi.waitFor(() => expect(status().state).toBe('connected'), { timeout: 5000 });
  });

  it('tests a connection without saving, and encrypts the saved token', async () => {
    await serve();
    const owner = await loginAs(ctx.app, ctx.services, 'owner');
    const test = (token?: string, p = port) =>
      api(ctx.app, { method: 'POST', url: '/api/v1/console/settings/test', cookie: owner, payload: { gameLogPath: null, paldefenderLogPath: null, logger: { host: '127.0.0.1', port: p, tls: false, token } } });
    expect((await test(TOKEN)).json().logger).toEqual({ ok: true, message: null });
    expect((await test('nope')).json().logger).toMatchObject({ ok: false, message: expect.stringContaining('rejected the token') });
    expect((await test(TOKEN, 1)).json().logger).toMatchObject({ ok: false });
    expect((await test(undefined)).json().logger.message).toContain('websocket_secret');

    const saved = await put(owner, '/api/v1/console/settings', { tailEnabled: false, gameLogPath: null, paldefenderLogPath: null, logger: { enabled: true, host: '127.0.0.1', port, tls: false, token: TOKEN } });
    expect(saved.json().settings.logger).toEqual({ enabled: true, host: '127.0.0.1', port, tls: false, hasToken: true });
    expect(JSON.stringify(saved.json())).not.toContain(TOKEN);
    const raw = ctx.services.db.prepare('SELECT logger_token_encrypted AS t FROM console_settings').get() as { t: string };
    expect(raw.t).not.toContain(TOKEN);
    // The saved token is used when the field is left blank.
    expect((await test(undefined)).json().logger).toEqual({ ok: true, message: null });
    const audit = ctx.services.audit.list({ category: 'console', limit: 1, offset: 0 }).entries[0]!;
    expect(JSON.stringify(audit)).not.toContain(TOKEN);
    expect(audit.details).toMatchObject({ loggerTokenChanged: true });
  });

  it('will not switch on without a token or host, and is admin-proof', async () => {
    const owner = await loginAs(ctx.app, ctx.services, 'owner');
    const noToken = await put(owner, '/api/v1/console/settings', { tailEnabled: false, gameLogPath: null, paldefenderLogPath: null, logger: { enabled: true, host: '127.0.0.1', port: 8765, tls: false } });
    expect(noToken.statusCode).toBe(400);
    expect(noToken.json().error.code).toBe('token_required');
    expect((await put(owner, '/api/v1/console/settings', { tailEnabled: false, gameLogPath: null, paldefenderLogPath: null, logger: { enabled: false, host: 'http://evil', port: 8765, tls: false } })).statusCode).toBe(400);
    const admin = await loginAs(ctx.app, ctx.services, 'admin');
    expect((await put(admin, '/api/v1/console/settings', { tailEnabled: false, gameLogPath: null, paldefenderLogPath: null })).statusCode).toBe(403);
  });
});
