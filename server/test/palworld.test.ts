import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PalworldError, RestApiAdapter } from '../src/services/palworld/index.js';
import { SecretBox } from '../src/utils/crypto.js';
import { api, createTestApp, loginAs } from './helpers.js';

/** A tiny stand-in for the Palworld REST API. */
let fake: Server;
let port: number;
const received: Array<{ url: string; body: string }> = [];
let gameDataEnabled = true;

beforeAll(async () => {
  fake = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ url: req.url!, body });
      const expected = `Basic ${Buffer.from('admin:secret-pass').toString('base64')}`;
      if (req.headers.authorization !== expected) {
        res.writeHead(401).end();
        return;
      }
      const json = (data: unknown) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
      switch (req.url) {
        case '/v1/api/info':
          return json({ version: 'v0.6.1', servername: 'Test Server', description: 'desc', worldguid: 'ABC' });
        case '/v1/api/metrics':
          return json({ serverfps: 60, currentplayernum: 1, serverframetime: 16.6, maxplayernum: 32, uptime: 120, days: 3 });
        case '/v1/api/players':
          return json({
            players: [
              { name: 'Zoe', accountName: 'zoe', playerId: 'P1', userId: 'steam_1', ip: '10.0.0.2', ping: 30.5, location_x: 1, location_y: 2, level: 9, building_count: 4 },
            ],
          });
        case '/v1/api/game-data':
          if (!gameDataEnabled) return res.writeHead(404).end();
          return json({
            Time: '2026-09-28 12:00:00',
            FPS: 55.5,
            AverageFPS: 57,
            ActorData: [
              { Type: 'Character', InstanceID: 'A1', UnitType: 'Player', NickName: 'Zoe', userid: 'steam_1', ip: '10.0.0.2', level: 9, HP: 400, MaxHP: 500, GuildID: 'G1', GuildName: 'Zoe Co', LocationX: 10, LocationY: 20, LocationZ: 30 },
              { Type: 'Character', InstanceID: 'A2', UnitType: 'OtomoPal', NickName: '', TrainerInstanceID: 'A1', Class: 'PinkCat', level: 5, LocationX: 11, LocationY: 21, LocationZ: 30 },
              { Type: 'Character', InstanceID: 'A3', UnitType: 'Mystery', LocationX: 0, LocationY: 0, LocationZ: 0 },
              { Type: 'Character', InstanceID: 'A4', UnitType: 'WildPal' },
              { Type: 'PalBox', GuildID: 'G1', GuildName: 'Zoe Co', LocationX: 100, LocationY: 200, LocationZ: 0 },
            ],
          });
        default:
          return res.writeHead(200).end('OK');
      }
    });
  });
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
  port = (fake.address() as AddressInfo).port;
});

afterAll(() => new Promise<void>((r) => fake.close(() => r())));

describe('RestApiAdapter', () => {
  const adapter = (password = 'secret-pass') => new RestApiAdapter({ host: '127.0.0.1', port, username: 'admin', password });

  it('maps the REST API into panel types', async () => {
    expect(await adapter().getInfo()).toEqual({ name: 'Test Server', description: 'desc', version: 'v0.6.1', worldGuid: 'ABC' });
    const metrics = await adapter().getMetrics();
    expect(metrics).toMatchObject({ fps: 60, currentPlayers: 1, maxPlayers: 32, uptimeSeconds: 120, inGameDays: 3, baseCampCount: null });
    const [player] = await adapter().getPlayers();
    expect(player).toMatchObject({ name: 'Zoe', userId: 'steam_1', level: 9, location: { x: 1, y: 2 } });
  });

  it('reads the world snapshot, skipping actors without a position', async () => {
    const world = await adapter().getWorld();
    expect(world).toMatchObject({ serverTime: '2026-09-28 12:00:00', fps: 55.5, averageFps: 57 });
    expect(world.characters.map((c) => c.unitType)).toEqual(['Player', 'OtomoPal', 'Other']);
    expect(world.characters[0]).toMatchObject({ userId: 'steam_1', guildId: 'G1', guildName: 'Zoe Co', location: { x: 10, y: 20, z: 30 } });
    expect(world.characters[1]).toMatchObject({ trainerInstanceId: 'A1', className: 'PinkCat', guildId: null });
    expect(world.palBoxes).toEqual([{ guildId: 'G1', guildName: 'Zoe Co', location: { x: 100, y: 200, z: 0 } }]);

    gameDataEnabled = false;
    await expect(adapter().getWorld()).rejects.toMatchObject({ code: 'unsupported' });
    gameDataEnabled = true;
  });

  it('sends actions as JSON and accepts plain-text replies', async () => {
    await adapter().kick('steam_1', 'bye');
    expect(received.at(-1)).toEqual({ url: '/v1/api/kick', body: JSON.stringify({ userid: 'steam_1', message: 'bye' }) });
  });

  it('reports bad credentials and unreachable servers distinctly', async () => {
    await expect(adapter('wrong').getInfo()).rejects.toMatchObject({ code: 'unauthorized' });
    const dead = new RestApiAdapter({ host: '127.0.0.1', port: 1, username: 'admin', password: 'x', timeoutMs: 500 });
    await expect(dead.getInfo()).rejects.toBeInstanceOf(PalworldError);
    await expect(dead.getInfo()).rejects.toMatchObject({ code: 'unreachable' });
  });
});

describe('SecretBox', () => {
  it('round-trips and detects tampering', () => {
    const box = new SecretBox('x'.repeat(32), 'test');
    const sealed = box.encrypt('hunter2');
    expect(sealed).not.toContain('hunter2');
    expect(box.decrypt(sealed)).toBe('hunter2');
    const parts = sealed.split(':');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => box.decrypt(parts.join(':'))).toThrow();
    expect(() => new SecretBox('y'.repeat(32), 'test').decrypt(sealed)).toThrow();
  });
});

describe('server connection API', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let cookie: string;
  beforeEach(async () => {
    ctx = await createTestApp();
    cookie = await loginAs(ctx.app, ctx.services, 'owner');
  });

  it('reports unconfigured before setup', async () => {
    const res = await api(ctx.app, { method: 'GET', url: '/api/v1/server/status', cookie });
    expect(res.json().state).toBe('unconfigured');
    expect((await api(ctx.app, { method: 'GET', url: '/api/v1/players', cookie })).statusCode).toBe(409);
  });

  it('saves a connection, never returns or logs the password, and goes online', async () => {
    const save = await api(ctx.app, {
      method: 'PUT',
      url: '/api/v1/server/connection',
      cookie,
      payload: { name: 'Main', adapter: 'rest', host: '127.0.0.1', port, username: 'admin', password: 'secret-pass' },
    });
    expect(save.statusCode).toBe(200);
    expect(save.body).not.toContain('secret-pass');
    expect(save.json().connection.hasPassword).toBe(true);

    const stored = ctx.services.db.prepare('SELECT password_encrypted FROM servers').get() as { password_encrypted: string };
    expect(stored.password_encrypted).not.toContain('secret-pass');
    const audit = await api(ctx.app, { method: 'GET', url: '/api/v1/logs/audit', cookie });
    expect(audit.body).not.toContain('secret-pass');
    expect(audit.body).toContain('connection_updated');

    const status = await api(ctx.app, { method: 'GET', url: '/api/v1/server/status?fresh=1', cookie });
    expect(status.json()).toMatchObject({ state: 'online', info: { name: 'Test Server' } });

    // Saving again without a password keeps the stored one.
    await api(ctx.app, {
      method: 'PUT',
      url: '/api/v1/server/connection',
      cookie,
      payload: { name: 'Renamed', adapter: 'rest', host: '127.0.0.1', port, username: 'admin' },
    });
    const players = await api(ctx.app, { method: 'GET', url: '/api/v1/players', cookie });
    expect(players.json().players[0].name).toBe('Zoe');
  });

  it('reports offline when the server is unreachable', async () => {
    await api(ctx.app, {
      method: 'PUT',
      url: '/api/v1/server/connection',
      cookie,
      payload: { name: 'Main', adapter: 'rest', host: '127.0.0.1', port: 1, username: 'admin', password: 'x' },
    });
    const status = await api(ctx.app, { method: 'GET', url: '/api/v1/server/status?fresh=1', cookie });
    expect(status.json().state).toBe('offline');
  });

  it('rejects hosts that are not plain hostnames or IPs', async () => {
    for (const host of ['http://evil', 'a b', '127.0.0.1/../x', 'user@host']) {
      const res = await api(ctx.app, {
        method: 'PUT',
        url: '/api/v1/server/connection',
        cookie,
        payload: { name: 'Main', adapter: 'rest', host, port: 8212, username: 'admin', password: 'x' },
      });
      expect(res.statusCode, host).toBe(400);
    }
  });

  it('broadcasts through the mock adapter and audits it', async () => {
    await api(ctx.app, {
      method: 'PUT',
      url: '/api/v1/server/connection',
      cookie,
      payload: { name: 'Dev', adapter: 'mock', host: '', port: 8212, username: 'admin' },
    });
    const res = await api(ctx.app, { method: 'POST', url: '/api/v1/server/announce', cookie, payload: { message: 'Restart soon' } });
    expect(res.statusCode).toBe(200);
    expect(ctx.services.palworld.mock.announcements).toEqual(['Restart soon']);
  });
});
