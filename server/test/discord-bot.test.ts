import { generateKeyPairSync, sign } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyDiscordSignature } from '../src/services/discord/interactions.js';
import { escapeMd } from '../src/services/discord/discord-bot.js';
import { api, createTestApp, loginAs } from './helpers.js';

const BOT_TOKEN = 'bot-token-abc.def';
const APP = '111111111111111111';
const GUILD = '222222222222222222';
const EVENTS = '333333333333333333';
const LOGS = '444444444444444444';
const OWNER_DISCORD = '555555555555555551';
const ADMIN_DISCORD = '555555555555555552';
const MOD_DISCORD = '555555555555555553';
const STRANGER = '555555555555555559';
const ANUBIS = 'steam_76561190000000002';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const PUBLIC_HEX = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
const signature = (timestamp: string, body: string, key = privateKey) => sign(null, Buffer.from(timestamp + body), key).toString('hex');

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
  auth: string | undefined;
}

let discord: Server;
let discordUrl: string;
let calls: Call[] = [];
let failing = new Map<string, number>();

beforeAll(async () => {
  discord = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const path = req.url ?? '';
      calls.push({ method: req.method ?? '', path, body: raw ? (JSON.parse(raw) as Record<string, unknown>) : null, auth: req.headers.authorization });
      const send = (status: number, body: unknown) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
      for (const [prefix, status] of failing) if (path.startsWith(prefix)) return send(status, { message: 'Missing Access' });
      if (!path.startsWith('/webhooks') && req.headers.authorization !== `Bot ${BOT_TOKEN}`) return send(401, { message: '401: Unauthorized' });
      if (path === '/users/@me') return send(200, { id: '999', username: 'PalOpsBot' });
      if (path.startsWith('/guilds/')) return send(200, { id: GUILD, name: 'Palworld Friends' });
      if (path.startsWith('/channels/') && req.method === 'GET') return send(200, { id: path.split('/')[2], name: 'palworld' });
      if (path.includes('/messages')) return send(200, { id: '1' });
      if (path.includes('/commands')) return send(200, []);
      return send(404, { message: 'Unknown' });
    });
  });
  await new Promise<void>((r) => discord.listen(0, '127.0.0.1', r));
  discordUrl = `http://127.0.0.1:${(discord.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => discord.close(() => r())));

let ctx: Awaited<ReturnType<typeof createTestApp>>;

const settings = (over: Record<string, unknown> = {}) => ({
  enabled: true,
  applicationId: APP,
  publicKey: PUBLIC_HEX,
  botToken: BOT_TOKEN,
  guildId: GUILD,
  publicInfo: false,
  eventsChannelId: EVENTS,
  logChannelId: LOGS,
  logMinLevel: 'error',
  notifyBans: true,
  notifySignals: true,
  notifyServer: true,
  notifyJoins: false,
  ...over,
});

beforeEach(async () => {
  calls = [];
  failing = new Map();
  ctx = await createTestApp();
  ctx.services.servers.savePrimary({ name: 'Dev', adapter: 'mock', host: '', port: 8212, username: 'admin' });
  await ctx.services.players.refreshOnline();
  ctx.services.discordBot.setApiBase(discordUrl);
  const link = async (username: string, role: 'owner' | 'admin' | 'moderator', id: string) => {
    await ctx.services.users.create({ username, password: 'correct-horse-battery', role, discord: { id, username, avatar: null } });
  };
  await link('owner-user', 'owner', OWNER_DISCORD);
  await link('admin-user', 'admin', ADMIN_DISCORD);
  await link('moderator-user', 'moderator', MOD_DISCORD);
});

const put = (cookie: string, url: string, payload: Record<string, unknown>) => api(ctx.app, { method: 'PUT', url, cookie, payload });
const post = (cookie: string, url: string, payload: Record<string, unknown> = {}) => api(ctx.app, { method: 'POST', url, cookie, payload });
const get = (cookie: string, url: string) => api(ctx.app, { method: 'GET', url, cookie });

/** A request as Discord sends it: signed, and without the panel's CSRF header. */
function interact(body: Record<string, unknown>, opts: { key?: typeof privateKey; timestamp?: string; tamper?: boolean } = {}) {
  const raw = JSON.stringify(body);
  const timestamp = opts.timestamp ?? String(Math.floor(Date.now() / 1000));
  const sig = signature(timestamp, opts.tamper ? raw + ' ' : raw, opts.key);
  return ctx.app.inject({ method: 'POST', url: '/api/v1/discord/interactions', headers: { 'content-type': 'application/json', 'x-signature-ed25519': sig, 'x-signature-timestamp': timestamp }, payload: raw });
}

const command = (name: string, discordId: string, options: Array<Record<string, unknown>> = [], over: Record<string, unknown> = {}) => ({
  id: 'i1',
  type: 2,
  token: 'itoken',
  application_id: APP,
  guild_id: GUILD,
  member: { user: { id: discordId, username: 'someone' } },
  data: { name, options },
  ...over,
});

/** Runs a command and returns the immediate response plus the text Discord ends up showing. */
async function run(name: string, discordId: string, options: Array<Record<string, unknown>> = [], over: Record<string, unknown> = {}) {
  const res = await interact(command(name, discordId, options, over));
  await ctx.services.discordBot.idle();
  const edit = calls.filter((c) => c.method === 'PATCH').at(-1);
  return { immediate: res.json(), status: res.statusCode, text: edit?.body?.content as string | undefined, edit };
}

async function setup(over: Record<string, unknown> = {}) {
  const owner = await loginAs(ctx.app, ctx.services, 'owner');
  const res = await put(owner, '/api/v1/discord-bot/settings', settings(over));
  expect(res.statusCode).toBe(200);
  calls = [];
  return owner;
}

describe('request signatures', () => {
  const body = Buffer.from('{"type":1}');
  const now = Math.floor(Date.now() / 1000);
  const ts = String(now);
  it('accepts only a fresh, untampered request signed with the application key', () => {
    expect(verifyDiscordSignature(PUBLIC_HEX, signature(ts, '{"type":1}'), ts, body)).toBe(true);
    expect(verifyDiscordSignature(PUBLIC_HEX, signature(ts, '{"type":2}'), ts, body)).toBe(false);
    const other = generateKeyPairSync('ed25519').privateKey;
    expect(verifyDiscordSignature(PUBLIC_HEX, signature(ts, '{"type":1}', other), ts, body)).toBe(false);
    const old = String(now - 3600);
    expect(verifyDiscordSignature(PUBLIC_HEX, signature(old, '{"type":1}'), old, body)).toBe(false);
    expect(verifyDiscordSignature(PUBLIC_HEX, 'zz', ts, body)).toBe(false);
    expect(verifyDiscordSignature('nothex', signature(ts, '{"type":1}'), ts, body)).toBe(false);
    expect(verifyDiscordSignature(PUBLIC_HEX, signature(ts, '{"type":1}'), 'abc', body)).toBe(false);
  });
});

describe('the interactions endpoint', () => {
  it('is closed until a public key is saved, and rejects bad signatures', async () => {
    expect((await interact({ type: 1 })).statusCode).toBe(401);
    await setup();
    expect((await interact({ type: 1 }, { tamper: true })).statusCode).toBe(401);
    expect((await interact({ type: 1 }, { key: generateKeyPairSync('ed25519').privateKey })).statusCode).toBe(401);
    expect((await interact({ type: 1 }, { timestamp: '1000000000' })).statusCode).toBe(401);
    const unsigned = await ctx.app.inject({ method: 'POST', url: '/api/v1/discord/interactions', headers: { 'content-type': 'application/json' }, payload: '{"type":1}' });
    expect(unsigned.statusCode).toBe(401);
  });

  it('answers Discord’s ping, which is how it validates the endpoint URL', async () => {
    await setup({ enabled: false });
    const res = await interact({ type: 1 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ type: 1 });
  });

  it('exempts only this route from the CSRF header', async () => {
    const stray = await ctx.app.inject({ method: 'POST', url: '/api/v1/players/steam_1/kick', headers: { 'content-type': 'application/json' }, payload: '{}' });
    expect(stray.statusCode).toBe(403);
    const other = await ctx.app.inject({ method: 'POST', url: '/api/v1/discord/interactions/extra', headers: { 'content-type': 'application/json' }, payload: '{}' });
    expect(other.statusCode).toBe(403);
  });
});

describe('bot settings', () => {
  it('are owner-only, never return the token, and need the essentials to switch on', async () => {
    const admin = await loginAs(ctx.app, ctx.services, 'admin');
    expect((await get(admin, '/api/v1/discord-bot/settings')).statusCode).toBe(403);
    expect((await put(admin, '/api/v1/discord-bot/settings', settings())).statusCode).toBe(403);

    const owner = await loginAs(ctx.app, ctx.services, 'owner');
    const incomplete = await put(owner, '/api/v1/discord-bot/settings', settings({ botToken: undefined, publicKey: null }));
    expect(incomplete.statusCode).toBe(400);
    expect(incomplete.json().error.message).toContain('public key');
    expect((await put(owner, '/api/v1/discord-bot/settings', settings({ publicKey: 'short' }))).statusCode).toBe(400);
    expect((await put(owner, '/api/v1/discord-bot/settings', settings({ guildId: 'abc' }))).statusCode).toBe(400);

    const saved = await put(owner, '/api/v1/discord-bot/settings', settings());
    expect(saved.json().settings).toMatchObject({ enabled: true, hasToken: true, guildId: GUILD, publicKey: PUBLIC_HEX });
    expect(JSON.stringify(saved.json())).not.toContain(BOT_TOKEN);
    const raw = ctx.services.db.prepare('SELECT bot_token_encrypted AS t FROM discord_bot').get() as { t: string };
    expect(raw.t).not.toContain(BOT_TOKEN);

    // A blank token keeps the stored one.
    expect((await put(owner, '/api/v1/discord-bot/settings', settings({ botToken: '' }))).json().settings.hasToken).toBe(true);
    const audit = ctx.services.audit.list({ category: 'server', limit: 1, offset: 0 }).entries[0]!;
    expect(audit.action).toBe('discord_bot_updated');
    expect(JSON.stringify(audit)).not.toContain(BOT_TOKEN);

    const shown = (await get(owner, '/api/v1/discord-bot/settings')).json();
    expect(shown.interactionsUrl).toMatch(/\/api\/v1\/discord\/interactions$/);
    expect(shown.commands.map((c: { name: string }) => c.name)).toEqual(['status', 'players', 'player', 'kick', 'ban', 'unban', 'announce', 'save']);
  });

  it('check the token, server and channels, and register the slash commands', async () => {
    const owner = await setup();
    const checks = (await post(owner, '/api/v1/discord-bot/test', { guildId: GUILD, eventsChannelId: EVENTS, logChannelId: LOGS })).json().checks;
    expect(checks).toMatchObject([
      { name: 'Bot token', ok: true, message: 'Signed in as PalOpsBot' },
      { name: 'Server', ok: true, message: 'Palworld Friends' },
      { name: 'Events channel', ok: true },
      { name: 'Log channel', ok: true },
    ]);
    expect(calls[0]!.auth).toBe(`Bot ${BOT_TOKEN}`);

    failing.set('/channels/', 403);
    const partial = (await post(owner, '/api/v1/discord-bot/test', { guildId: GUILD, eventsChannelId: EVENTS })).json().checks;
    expect(partial.at(-1)).toMatchObject({ ok: false, message: expect.stringContaining('lacks access') });
    failing.clear();

    calls = [];
    const registered = (await post(owner, '/api/v1/discord-bot/register-commands')).json();
    expect(registered.count).toBe(8);
    expect(registered.settings.commandsRegisteredAt).not.toBeNull();
    expect(calls[0]).toMatchObject({ method: 'PUT', path: `/applications/${APP}/guilds/${GUILD}/commands` });
    expect((calls[0]!.body as unknown as Array<{ name: string }>).map((c) => c.name)).toContain('ban');

    failing.set('/applications', 401);
    const rejected = await post(owner, '/api/v1/discord-bot/register-commands');
    expect(rejected.statusCode).toBe(502);
    expect(rejected.json().error.message).toContain('rejected the bot token');
  });

  it('can send a test message', async () => {
    const owner = await setup();
    expect((await post(owner, '/api/v1/discord-bot/send-test')).statusCode).toBe(200);
    expect(calls.at(-1)).toMatchObject({ method: 'POST', path: `/channels/${EVENTS}/messages`, body: { allowed_mentions: { parse: [] } } });
  });
});

describe('slash commands', () => {
  it('answer straight away with "thinking…" and then fill in the reply', async () => {
    await setup();
    const { immediate, text, edit } = await run('status', ADMIN_DISCORD);
    expect(immediate).toEqual({ type: 5, data: { flags: 64 } });
    expect(text).toContain('is **online**');
    expect(text).toMatch(/Players: 3\/32/);
    expect(edit).toMatchObject({ path: '/webhooks/' + APP + '/itoken/messages/@original', body: { allowed_mentions: { parse: [] } } });
  });

  it('lists players, and looks one up without showing their address', async () => {
    await setup();
    expect((await run('players', ADMIN_DISCORD)).text).toContain('3 online');
    const found = (await run('player', ADMIN_DISCORD, [{ name: 'player', type: 3, value: 'Anubis' }])).text!;
    expect(found).toContain('**Anubis**');
    expect(found).toContain(ANUBIS);
    expect(found).not.toContain('198.51.100.23');
  });

  it('only let a linked user do what their panel role allows', async () => {
    await setup();
    expect((await run('status', STRANGER)).text).toContain('isn’t linked');
    // A moderator can kick but not ban, exactly like the web panel.
    const kick = await run('kick', MOD_DISCORD, [{ name: 'player', type: 3, value: ANUBIS }, { name: 'reason', type: 3, value: 'AFK' }]);
    expect(kick.text).toBe('Kicked **Anubis**.');
    const ban = await run('ban', MOD_DISCORD, [{ name: 'player', type: 3, value: 'CattivaFan' }]);
    expect(ban.text).toContain('moderator) isn’t allowed to use /ban');
    expect(ctx.services.moderation.isBanned('epic_0f3a9c2b1d')).toBe(false);
    expect((await run('announce', MOD_DISCORD, [{ name: 'message', type: 3, value: 'hi' }])).text).toContain('isn’t allowed');
    expect((await run('save', MOD_DISCORD)).text).toContain('isn’t allowed');
  });

  it('ban, unban, announce and save for an admin, and audit them as the panel user', async () => {
    await setup();
    const ban = await run('ban', ADMIN_DISCORD, [{ name: 'player', type: 3, value: 'Anubis' }, { name: 'reason', type: 3, value: 'Griefing' }, { name: 'ban_ip', type: 5, value: true }]);
    expect(ban.text).toContain('Banned **Anubis**');
    expect(ban.text).toContain('198.51.100.23');
    expect(ctx.services.moderation.isBanned(ANUBIS)).toBe(true);
    expect(ctx.services.moderation.history(ANUBIS)[0]).toMatchObject({ action: 'ban', reason: 'Griefing', actorUsername: 'admin-user (via Discord)' });

    expect((await run('unban', ADMIN_DISCORD, [{ name: 'player', type: 3, value: ANUBIS }])).text).toBe('Unbanned **Anubis**.');
    expect(ctx.services.moderation.isBanned(ANUBIS)).toBe(false);
    expect((await run('announce', ADMIN_DISCORD, [{ name: 'message', type: 3, value: 'Restart in 5' }])).text).toContain('Announced');
    expect(ctx.services.palworld.mock.announcements).toContain('Restart in 5');
    expect((await run('save', ADMIN_DISCORD)).text).toBe('Saving the world.');

    const actors = ctx.services.audit.list({ limit: 30, offset: 0 }).entries.map((e) => e.actorUsername);
    expect(actors).toContain('admin-user (via Discord)');
  });

  it('will not ban an address for someone who cannot see addresses', async () => {
    await setup();
    // Moderators can't ban at all; this checks the role gate stays in front.
    const res = await run('ban', MOD_DISCORD, [{ name: 'player', type: 3, value: 'Anubis' }, { name: 'ban_ip', type: 5, value: true }]);
    expect(res.text).toContain('isn’t allowed');
  });

  it('report an unknown or ambiguous player, and a server that is down, in plain words', async () => {
    await setup();
    expect((await run('kick', ADMIN_DISCORD, [{ name: 'player', type: 3, value: 'Nobody' }])).text).toContain('haven\'t seen a player called');
    ctx.services.palworld.mock.shutdown();
    ctx.services.palworld.invalidate();
    const down = await run('kick', ADMIN_DISCORD, [{ name: 'player', type: 3, value: 'Anubis' }]);
    expect(down.text).toContain('The Palworld server said');
    expect((await run('bogus', ADMIN_DISCORD)).text).toContain('don’t know that command');
  });

  it('only work in the configured server, and only while switched on', async () => {
    const owner = await setup();
    const elsewhere = await interact(command('status', ADMIN_DISCORD, [], { guild_id: '999999999999999999' }));
    expect(elsewhere.json()).toMatchObject({ type: 4, data: { flags: 64, content: expect.stringContaining('only works in its own server') } });
    await put(owner, '/api/v1/discord-bot/settings', settings({ enabled: false }));
    const off = await interact(command('status', ADMIN_DISCORD));
    expect(off.json()).toMatchObject({ type: 4, data: { content: expect.stringContaining('switched off') } });
  });

  it('let anyone use /status and /players when public info is on, but nothing else', async () => {
    await setup({ publicInfo: true });
    const status = await run('status', STRANGER);
    expect(status.immediate).toEqual({ type: 5, data: { flags: 0 } });
    expect(status.text).toContain('online');
    expect((await run('kick', STRANGER, [{ name: 'player', type: 3, value: 'Anubis' }])).text).toContain('isn’t linked');
    expect((await run('player', STRANGER, [{ name: 'player', type: 3, value: 'Anubis' }])).text).toContain('isn’t linked');
  });

  it('skip disabled panel users', async () => {
    await setup();
    const admin = ctx.services.users.findByDiscordId(ADMIN_DISCORD)!;
    ctx.services.users.update(admin.id, { disabled: true });
    expect((await run('status', ADMIN_DISCORD)).text).toContain('isn’t linked');
  });

  it('slow down someone sending too many at once', async () => {
    await setup();
    const results = [];
    for (let i = 0; i < 8; i++) results.push((await interact(command('status', ADMIN_DISCORD))).json());
    await ctx.services.discordBot.idle();
    expect(results.filter((r) => r.type === 4 && r.data.content.includes('Slow down'))).toHaveLength(2);
  });

  it('suggest known players as you type, but only to those allowed to see them', async () => {
    await setup();
    const suggest = (discordId: string, typed: string) =>
      interact(command('ban', discordId, [{ name: 'player', type: 3, value: typed, focused: true }], { type: 4 })).then((r) => r.json());
    const linked = await suggest(ADMIN_DISCORD, 'anu');
    expect(linked).toEqual({ type: 8, data: { choices: [{ name: `Anubis (${ANUBIS})`, value: ANUBIS }] } });
    expect(await suggest(STRANGER, 'anu')).toEqual({ type: 8, data: { choices: [] } });
    // A moderator can't ban, so the suggestions for /ban stay empty for them too.
    expect(await suggest(MOD_DISCORD, 'anu')).toEqual({ type: 8, data: { choices: [] } });
  });

  it('escape markdown and mentions in names', () => {
    expect(escapeMd('@everyone *bold* _x_ `code`')).toBe('\\@everyone \\*bold\\* \\_x\\_ \\`code\\`');
  });
});

describe('the events and log channels', () => {
  const posted = (channel: string) => calls.filter((c) => c.method === 'POST' && c.path === `/channels/${channel}/messages`).map((c) => c.body as { content: string; allowed_mentions: unknown });

  it('announce bans, kicks and address bans as they happen, without pinging anyone', async () => {
    await setup();
    await ctx.services.moderation.kick({ userId: null, username: 'owner-user' }, ANUBIS, 'AFK');
    await ctx.services.moderation.ban({ userId: null, username: '@everyone' }, 'epic_0f3a9c2b1d', 'x');
    await vi.waitFor(() => expect(posted(EVENTS).length).toBeGreaterThan(0), { timeout: 3000 });
    const all = posted(EVENTS).map((p) => p.content).join('\n');
    expect(all).toContain('**owner\\-user** kicked'.replace('\\-', '-'));
    expect(all).toContain('\\@everyone');
    expect(all).toContain('banned');
    expect(posted(EVENTS).every((p) => JSON.stringify(p.allowed_mentions) === '{"parse":[]}')).toBe(true);
  });

  it('batches a burst into one message, and joins are off until asked for', async () => {
    await setup();
    for (let i = 0; i < 6; i++) ctx.services.audit.record({ userId: null, username: 'owner-user' }, { category: 'players', action: 'kick', target: `Player${i}` });
    await vi.waitFor(() => expect(posted(EVENTS)).toHaveLength(1), { timeout: 3000 });
    expect(posted(EVENTS)[0]!.content.split('\n')).toHaveLength(6);

    const player = (name: string, userId: string) => ({ name, accountName: name, playerId: userId, userId, ip: null, ping: 1, level: 1, location: null, buildingCount: null, guild: null });
    const serverId = ctx.services.servers.getPrimary()!.id;
    ctx.services.players.record(serverId, [player('A', 'steam_a')]);
    ctx.services.players.record(serverId, [player('A', 'steam_a'), player('B', 'steam_b')]);
    await new Promise((r) => setTimeout(r, 700));
    expect(posted(EVENTS).map((p) => p.content).join('\n')).not.toContain('joined');
  });

  it('announces joins and leaves when enabled', async () => {
    await setup({ notifyJoins: true });
    const player = (name: string, userId: string) => ({ name, accountName: name, playerId: userId, userId, ip: null, ping: 1, level: 1, location: null, buildingCount: null, guild: null });
    const serverId = ctx.services.servers.getPrimary()!.id;
    ctx.services.players.record(serverId, [player('A', 'steam_a')]);
    ctx.services.players.record(serverId, [player('A', 'steam_a'), player('B', 'steam_b')]);
    await vi.waitFor(() => expect(posted(EVENTS).map((p) => p.content).join('\n')).toContain('B joined'), { timeout: 3000 });
  });

  it('tells the channel when the server goes down and when it is back, ignoring a single blip', async () => {
    await setup();
    const bot = ctx.services.discordBot;
    await bot.checkServer();
    ctx.services.palworld.mock.shutdown();
    await bot.checkServer();
    await new Promise((r) => setTimeout(r, 600));
    expect(posted(EVENTS)).toHaveLength(0);
    await bot.checkServer();
    await vi.waitFor(() => expect(posted(EVENTS).map((p) => p.content).join('\n')).toContain('offline'), { timeout: 3000 });
    ctx.services.palworld.mock.start();
    await bot.checkServer();
    await vi.waitFor(() => expect(posted(EVENTS).map((p) => p.content).join('\n')).toContain('back online'), { timeout: 3000 });
  });

  it('forwards only the game and PalDefender warnings and errors to the log channel', async () => {
    await setup({ logMinLevel: 'warn' });
    const c = ctx.services.console;
    c.add('game', 'LogPal: all fine');
    c.add('game', 'LogNet: Warning: slow client');
    c.add('paldefender', '[Error] illegal ``` item');
    c.add('panel', 'owner: settings updated', 'error');
    c.flush();
    await vi.waitFor(() => expect(posted(LOGS)).toHaveLength(1), { timeout: 3000 });
    const body = posted(LOGS)[0]!.content;
    expect(body).toContain('slow client');
    expect(body).toContain('illegal');
    expect(body).not.toContain('all fine');
    expect(body).not.toContain('settings updated');
    expect(body.startsWith('```\n')).toBe(true);
    // A triple backtick in the log can't break out of the code block.
    expect(body.slice(4, -4)).not.toContain('```');
  });

  it('stays quiet when switched off or when a channel is not set', async () => {
    const owner = await setup({ eventsChannelId: null, logChannelId: null });
    ctx.services.audit.record({ userId: null, username: 'x' }, { category: 'players', action: 'ban', target: 'Y' });
    ctx.services.console.add('game', '[Error] boom');
    ctx.services.console.flush();
    await new Promise((r) => setTimeout(r, 700));
    expect(calls.filter((c) => c.path.includes('/messages'))).toEqual([]);
    await put(owner, '/api/v1/discord-bot/settings', settings({ enabled: false }));
    ctx.services.audit.record({ userId: null, username: 'x' }, { category: 'players', action: 'ban', target: 'Y' });
    await new Promise((r) => setTimeout(r, 700));
    expect(calls.filter((c) => c.path.includes('/messages'))).toEqual([]);
  });
});
