import { beforeEach, describe, expect, it } from 'vitest';
import { toCsv } from '../src/utils/csv.js';
import { api, createTestApp, loginAs } from './helpers.js';

const ANUBIS = 'steam_76561190000000002';
const LAMBALL = 'steam_76561190000000001';

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let serverId: number;

beforeEach(async () => {
  ctx = await createTestApp();
  serverId = ctx.services.servers.savePrimary({ name: 'Dev', adapter: 'mock', host: '', port: 8212, username: 'admin' }).id;
  await ctx.services.players.refreshOnline();
});

const get = (cookie: string, url: string) => api(ctx.app, { method: 'GET', url, cookie });
const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();
const seed = (userId: string, spans: Array<[number, number | null]>) => {
  ctx.services.db.prepare('DELETE FROM player_sessions WHERE user_id = ?').run(userId);
  for (const [start, end] of spans) ctx.services.db.prepare('INSERT INTO player_sessions (server_id, user_id, started_at, ended_at) VALUES (?, ?, ?, ?)').run(serverId, userId, ago(start), end === null ? null : ago(end));
};

describe('csv', () => {
  it('quotes cells, and defuses spreadsheet formulas', () => {
    const out = toCsv([{ a: 'say "hi", ok', b: '=HYPERLINK("x")', c: true, d: null }], [
      { header: 'A', value: (r) => r.a },
      { header: 'B', value: (r) => r.b },
      { header: 'C', value: (r) => r.c },
      { header: 'D', value: (r) => r.d },
    ]);
    expect(out).toBe('﻿A,B,C,D\r\n"say ""hi"", ok","\'=HYPERLINK(""x"")",yes,\r\n');
  });
});

describe('exports', () => {
  it('exports players with playtime and sessions, addresses only for staff with players.ip', async () => {
    seed(ANUBIS, [[7200, 3600], [1800, 900]]);
    const admin = await loginAs(ctx.app, ctx.services, 'admin');
    const res = await get(admin, '/api/v1/players/export.csv');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="palops-players-\d{4}-\d{2}-\d{2}\.csv"/);
    const lines = res.body.replace('﻿', '').trim().split('\r\n');
    expect(lines[0]).toContain('Playtime (seconds)');
    expect(lines[0]).toContain('Last IP address');
    const anubis = lines.find((l) => l.startsWith(ANUBIS))!.split(',');
    expect(anubis).toContain('4500'); // 3600 + 900
    expect(anubis).toContain('2');

    const viewer = await loginAs(ctx.app, ctx.services, 'viewer');
    const plain = (await get(viewer, '/api/v1/players/export.csv')).body;
    expect(plain).not.toContain('Last IP address');
    expect(plain).not.toContain('198.51.100');
    expect(ctx.services.audit.list({ category: 'players', limit: 5, offset: 0 }).entries.map((e) => e.action)).toContain('export');
  });

  it('exports player and address bans', async () => {
    const admin = await loginAs(ctx.app, ctx.services, 'admin');
    await api(ctx.app, { method: 'POST', url: `/api/v1/players/${ANUBIS}/ban`, cookie: admin, payload: { reason: 'Cheating, again', banAddress: true } });
    const csv = (await get(admin, '/api/v1/players/bans/export.csv')).body;
    expect(csv).toContain(`player,${ANUBIS},Anubis,"Cheating, again"`);
    expect(csv).toContain('address,198.51.100.23');

    const mod = await loginAs(ctx.app, ctx.services, 'moderator');
    const modCsv = (await get(mod, '/api/v1/players/bans/export.csv')).body;
    expect(modCsv).toContain(`player,${ANUBIS}`);
  });

  it('needs a signed-in user', async () => {
    expect((await api(ctx.app, { method: 'GET', url: '/api/v1/players/export.csv' })).statusCode).toBe(401);
  });
});

describe('metrics', () => {
  it('summarises visits: unique players, playtime, average visit, peak and daily series', async () => {
    seed(ANUBIS, [[7200, 3600]]);
    seed(LAMBALL, [[5400, 1800]]);
    ctx.services.db.prepare("DELETE FROM player_sessions WHERE user_id NOT IN (?, ?)").run(ANUBIS, LAMBALL);
    const m = (await get(await loginAs(ctx.app, ctx.services, 'viewer'), '/api/v1/players/metrics')).json();
    expect(m.uniquePlayers).toEqual({ day: 2, week: 2, month: 2 });
    expect(m.playtimeSeconds.day).toBe(3600 + 3600);
    expect(m.averageSessionSeconds).toBe(3600);
    expect(m.sessions30d).toBe(2);
    expect(m.peakConcurrent.count).toBe(2);
    expect(m.daily).toHaveLength(14);
    expect(m.busiestHours).toHaveLength(24);
    expect(m.busiestHours.reduce((s: number, h: { seconds: number }) => s + h.seconds, 0)).toBe(7200);
  });

  it('adds recent windows and a daily series to a profile', async () => {
    seed(ANUBIS, [[7200, 3600], [3 * 86400 + 600, 3 * 86400]]);
    const profile = (await get(await loginAs(ctx.app, ctx.services, 'viewer'), `/api/v1/players/${ANUBIS}`)).json();
    expect(profile.activity).toMatchObject({ sessions: 2, seconds: 3600 + 600, seconds7d: 4200, seconds30d: 4200 });
    expect(profile.activity.daily).toHaveLength(14);
  });
});
