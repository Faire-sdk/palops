import { beforeEach, describe, expect, it } from 'vitest';
import type { WorldCharacter, WorldSnapshot } from '../src/services/palworld/index.js';
import { fromMap, toMap } from '../src/services/world/map-coords.js';
import { api, createTestApp, loginAs } from './helpers.js';

let ctx: Awaited<ReturnType<typeof createTestApp>>;
const ANUBIS = 'steam_76561190000000002';
const LAMBALL = 'steam_76561190000000001';

beforeEach(async () => {
  ctx = await createTestApp();
  ctx.services.servers.savePrimary({ name: 'Dev', adapter: 'mock', host: '', port: 8212, username: 'admin' });
  await ctx.services.players.refreshOnline();
});

const get = (cookie: string, url: string) => api(ctx.app, { method: 'GET', url, cookie });

function player(userId: string, name: string, x: number, y: number, extra: Partial<WorldCharacter> = {}): WorldCharacter {
  return {
    instanceId: `p-${userId}`,
    unitType: 'Player',
    name,
    className: null,
    trainerInstanceId: null,
    userId,
    ip: null,
    level: 10,
    hp: 500,
    maxHp: 500,
    guildId: 'G1',
    guildName: 'Testers',
    location: fromMap({ x, y }),
    ...extra,
  };
}

const snapshot = (characters: WorldCharacter[]): WorldSnapshot => ({ serverTime: null, fps: 50, averageFps: 50, characters, palBoxes: [] });

describe('world data', () => {
  it('fills in guilds, bases and pals from the mock world', async () => {
    await ctx.services.world.refresh();
    const mod = await loginAs(ctx.app, ctx.services, 'moderator');

    const guilds = (await get(mod, '/api/v1/world/guilds')).json().guilds;
    expect(guilds.map((g: { name: string }) => g.name).sort()).toEqual(['Cattiva Club', 'Desert Kings', 'Wool Gatherers']);
    expect(guilds.find((g: { name: string }) => g.name === 'Wool Gatherers')).toMatchObject({ members: 1, online: 1, bases: 2 });

    const detail = (await get(mod, '/api/v1/world/guilds/G-DESERT')).json();
    expect(detail.members.map((m: { name: string }) => m.name)).toEqual(['Anubis']);
    expect(detail.bases[0].workers.length).toBeGreaterThan(0);

    // CattivaFan has no guild in the online list; the world snapshot supplies it.
    const known = (await get(mod, '/api/v1/players/known?search=Cattiva')).json();
    expect(known.players[0]).toMatchObject({ name: 'CattivaFan', guild: 'Cattiva Club' });

    const profile = (await get(mod, `/api/v1/players/${LAMBALL}`)).json();
    expect(profile.pals).toMatchObject([{ name: 'Fluffy', unitType: 'OtomoPal', active: true }]);

    const map = (await get(mod, '/api/v1/world/map')).json().map;
    expect(map.players).toHaveLength(3);
    expect(map.bases).toHaveLength(4);
    expect(map.players[0]).not.toHaveProperty('ip');
  });

  it('keeps positions staff-only and guilds public only when the player list is', async () => {
    await ctx.services.world.refresh();
    const viewer = await loginAs(ctx.app, ctx.services, 'viewer');
    expect((await get(viewer, '/api/v1/world/map')).statusCode).toBe(403);
    expect((await get(viewer, '/api/v1/world/guilds')).statusCode).toBe(200);
    expect((await get(viewer, `/api/v1/players/${LAMBALL}`)).json().signals).toEqual([]);

    const pub = (await ctx.app.inject({ method: 'GET', url: '/api/v1/public/guilds' })).json();
    expect(pub.guilds[0]).toEqual({ name: expect.any(String), members: expect.any(Number), online: expect.any(Number), bases: expect.any(Number) });

    const hidden = await createTestApp({ SITE_SHOW_ONLINE_PLAYERS: 'false' });
    expect((await hidden.app.inject({ method: 'GET', url: '/api/v1/public/guilds' })).statusCode).toBe(403);
  });

  it('reports when the server has the world endpoint switched off', async () => {
    ctx.services.palworld.mock.worldEnabled = false;
    const status = await ctx.services.world.refresh();
    expect(status).toMatchObject({ state: 'disabled', counts: null });
    const mod = await loginAs(ctx.app, ctx.services, 'moderator');
    expect((await get(mod, '/api/v1/world/map')).json().map).toBeNull();
  });

  it('flags impossible movement, level jumps and shared addresses once', async () => {
    const world = ctx.services.world;
    const t0 = Date.now();
    const at = (s: number) => new Date(t0 + s * 1000);

    world.ingest(snapshot([player(ANUBIS, 'Anubis', 0, 0, { level: 20, ip: '10.0.0.5' }), player(LAMBALL, 'Lamball Enjoyer', 50, 50, { ip: '10.0.0.5' })]), at(0));
    // 400 map units is about 1.85 km, covered in 20 s.
    world.ingest(snapshot([player(ANUBIS, 'Anubis', 400, 0, { level: 27, ip: '10.0.0.5' }), player(LAMBALL, 'Lamball Enjoyer', 51, 50, { ip: '10.0.0.5' })]), at(20));
    world.ingest(snapshot([player(ANUBIS, 'Anubis', 0, 0, { level: 27, ip: '10.0.0.5' }), player(LAMBALL, 'Lamball Enjoyer', 52, 50, { ip: '10.0.0.5' })]), at(40));

    const { signals } = world.signals({ limit: 50, offset: 0 });
    const kinds = signals.map((s) => `${s.kind}:${s.playerName}`).sort();
    // The second jump is within the dedupe window; each shared-address player is flagged once.
    expect(kinds).toEqual(['level:Anubis', 'movement:Anubis', 'shared_ip:Anubis', 'shared_ip:Lamball Enjoyer']);
    expect(signals.find((s) => s.kind === 'level')!.summary).toBe('Went from level 20 to 27 in 1 min.');

    const mod = await loginAs(ctx.app, ctx.services, 'moderator');
    const id = signals.find((s) => s.kind === 'movement')!.id;
    const res = await api(ctx.app, { method: 'POST', url: `/api/v1/world/signals/${id}/dismiss`, cookie: mod });
    expect(res.json().signal).toMatchObject({ dismissedBy: 'moderator-user' });
    expect(world.signals({ limit: 50, offset: 0 }).total).toBe(3);
    expect(ctx.services.audit.list({ category: 'players', limit: 1, offset: 0 }).entries[0]).toMatchObject({ action: 'signal_dismissed' });

    const viewer = await loginAs(ctx.app, ctx.services, 'viewer');
    expect((await api(ctx.app, { method: 'POST', url: `/api/v1/world/signals/${id}/dismiss`, cookie: viewer })).statusCode).toBe(403);
  });

  it('matches FPS to the busiest areas', async () => {
    const world = ctx.services.world;
    const crowd = (n: number, x: number) =>
      Array.from({ length: n }, (_, i): WorldCharacter => ({ ...player(`wild${x}-${i}`, '', x, 0), unitType: 'WildPal', userId: null, instanceId: `w${x}-${i}` }));
    world.ingest({ ...snapshot([...crowd(80, 300), ...crowd(5, -300)]), fps: 30 });
    world.ingest({ ...snapshot(crowd(5, -300)), fps: 60 });

    const perf = world.performance(24);
    expect(perf.timeline).toHaveLength(2);
    expect(perf.avgFps).toBe(45);
    expect(perf.hotspots[0]).toMatchObject({ avgActors: 80, avgFps: 30, fpsVsAverage: -15, samples: 1 });
    expect(perf.hotspots[1]).toMatchObject({ avgActors: 5, avgFps: 45, fpsVsAverage: 0, samples: 2 });
    expect(Math.abs(perf.hotspots[0]!.center.x - 300)).toBeLessThan(60);
  });

  it('converts between world and map coordinates', () => {
    const p = toMap(fromMap({ x: -123.4, y: 567.8 }));
    expect(p).toEqual({ x: -123.4, y: 567.8 });
  });
});
