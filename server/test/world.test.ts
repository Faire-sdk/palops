import { beforeEach, describe, expect, it } from 'vitest';
import type { WorldCharacter, WorldPalBox, WorldSnapshot } from '../src/services/palworld/index.js';
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

  it('flags players from other guilds standing at a base, once per visit', async () => {
    const world = ctx.services.world;
    const box = (guildId: string, guildName: string, x: number, y: number): WorldPalBox => ({ guildId, guildName, location: fromMap({ x, y }) });
    const boxes = [box('G-HOME', 'Home Guild', 0, 0)];
    const t0 = Date.now();

    // Anubis (guild G1) is about 46 m from Home Guild's box; Lamball is a member of it, and Cattiva is far away.
    const inside = [
      player(ANUBIS, 'Anubis', 10, 0),
      player(LAMBALL, 'Lamball Enjoyer', 5, 0, { guildId: 'G-HOME', guildName: 'Home Guild' }),
      player('steam_3', 'Far Away', 200, 0),
    ];
    world.ingest({ ...snapshot(inside), palBoxes: boxes }, new Date(t0));
    world.ingest({ ...snapshot(inside), palBoxes: boxes }, new Date(t0 + 20000));

    const { signals } = world.signals({ limit: 50, offset: 0 });
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ kind: 'base_intrusion', playerName: 'Anubis' });
    expect(signals[0]!.summary).toContain("Home Guild's base");
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

describe('map image', () => {
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
  const upload = (cookie: string, body: Buffer, type = 'image/png', size = 'width=2000&height=1000') =>
    api(ctx.app, { method: 'PUT', url: `/api/v1/world/map-image?${size}`, cookie, payload: body, headers: { 'content-type': type } });

  it('lets admins upload, align and remove it, and staff view it', async () => {
    const admin = await loginAs(ctx.app, ctx.services, 'admin');
    const res = await upload(admin, PNG);
    expect(res.statusCode).toBe(200);
    // A wide image gets a centred guess that keeps its shape until it's aligned.
    expect(res.json().image).toMatchObject({ width: 2000, height: 1000, aligned: false, bounds: { left: -1000, right: 1000, top: 500, bottom: -500 } });

    const mod = await loginAs(ctx.app, ctx.services, 'moderator');
    const file = await get(mod, '/api/v1/world/map-image/file');
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.rawPayload.equals(PNG)).toBe(true);
    expect((await upload(mod, PNG)).statusCode).toBe(403);

    const bounds = { left: -1200, top: 900, right: 1100, bottom: -1000 };
    const aligned = await api(ctx.app, { method: 'PATCH', url: '/api/v1/world/map-image', cookie: admin, payload: bounds });
    expect(aligned.json().image).toMatchObject({ aligned: true, bounds });
    const mirrored = await api(ctx.app, { method: 'PATCH', url: '/api/v1/world/map-image', cookie: admin, payload: { ...bounds, right: -1300 } });
    expect(mirrored.statusCode).toBe(400);

    // Re-uploading an image of the same shape keeps the alignment.
    expect((await upload(admin, PNG, 'image/png', 'width=4000&height=2000')).json().image).toMatchObject({ aligned: true, bounds });

    expect((await api(ctx.app, { method: 'DELETE', url: '/api/v1/world/map-image', cookie: admin })).statusCode).toBe(200);
    expect((await get(mod, '/api/v1/world/map-image')).json().image).toBeNull();
    expect((await get(mod, '/api/v1/world/map-image/file')).statusCode).toBe(404);
    expect(ctx.services.audit.list({ category: 'config', limit: 10, offset: 0 }).entries.map((e) => e.action)).toEqual([
      'map_image_removed',
      'map_image_uploaded',
      'map_image_aligned',
      'map_image_uploaded',
    ]);
  });

  it('rejects files that are not images and unsupported types', async () => {
    const admin = await loginAs(ctx.app, ctx.services, 'admin');
    expect((await upload(admin, Buffer.from('<svg onload=alert(1)>'), 'image/png')).statusCode).toBe(400);
    expect((await upload(admin, PNG, 'image/svg+xml')).statusCode).toBe(415);
    expect((await upload(admin, PNG, 'image/png', 'width=0&height=10')).statusCode).toBe(400);
    const viewer = await loginAs(ctx.app, ctx.services, 'viewer');
    expect((await get(viewer, '/api/v1/world/map-image/file')).statusCode).toBe(403);
  });
});
