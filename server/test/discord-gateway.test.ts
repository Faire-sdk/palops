import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiscordGateway, Intents, type Presence } from '../src/services/discord/gateway.js';
import { api, createTestApp, loginAs } from './helpers.js';
import { startFakeGateway, startFakeRest } from './fake-discord.js';

const BOT_TOKEN = 'bot-token-abc.def';
const APP = '111111111111111111';
const GUILD = '222222222222222222';
const STATUS_CHANNEL = '666666666666666666';
const EVENTS = '333333333333333333';
const PUBLIC_KEY = 'a'.repeat(64);
const ADMIN_DISCORD = '555555555555555552';

let gateway: Awaited<ReturnType<typeof startFakeGateway>>;
let clients: DiscordGateway[] = [];
beforeEach(() => {
  clients = [];
});
afterEach(async () => {
  for (const c of clients) c.stop();
  await gateway?.close();
});

const connect = (over: Partial<ConstructorParameters<typeof DiscordGateway>[0]> = {}, presence: Presence = { status: 'online', activity: { name: '3/32 players', type: 3 } }) => {
  const events: Array<[string, unknown]> = [];
  const client = new DiscordGateway({ token: BOT_TOKEN, intents: Intents.Guilds, presence: () => presence, onDispatch: (e, d) => events.push([e, d]), url: gateway.url, ...over });
  clients.push(client);
  client.start();
  return { client, events };
};

describe('gateway client', () => {
  it('identifies with the token, intents and presence, keeps the heartbeat, and passes events on', async () => {
    gateway = await startFakeGateway({ heartbeatMs: 100 });
    const { client, events } = connect({ intents: Intents.Guilds | Intents.GuildMessages });
    await vi.waitFor(() => expect(client.status()).toMatchObject({ state: 'connected', botUserId: '999' }));
    const [identify] = gateway.ofOp(2);
    expect(identify!.d).toMatchObject({
      token: BOT_TOKEN,
      intents: Intents.Guilds | Intents.GuildMessages,
      presence: { status: 'online', activities: [{ name: '3/32 players', type: 3 }], afk: false },
    });
    await vi.waitFor(() => expect(gateway.ofOp(1).length).toBeGreaterThanOrEqual(2), { timeout: 2000 });
    gateway.dispatchAll('MESSAGE_CREATE', { content: 'hi' });
    await vi.waitFor(() => expect(events.map((e) => e[0])).toContain('MESSAGE_CREATE'));
  });

  it('sends a presence update on request', async () => {
    gateway = await startFakeGateway();
    let presence: Presence = { status: 'online', activity: { name: '3/32 players', type: 3 } };
    const { client } = connect({ presence: () => presence });
    await vi.waitFor(() => expect(client.status().state).toBe('connected'));
    presence = { status: 'dnd', activity: { name: 'Server offline', type: 3 } };
    client.updatePresence();
    await vi.waitFor(() => expect(gateway.ofOp(3)).toHaveLength(1));
    expect(gateway.ofOp(3)[0]!.d).toMatchObject({ status: 'dnd', activities: [{ name: 'Server offline', type: 3 }] });
  });

  it('resumes the same session after the connection drops', async () => {
    gateway = await startFakeGateway();
    const { client } = connect();
    await vi.waitFor(() => expect(client.status().state).toBe('connected'));
    gateway.dropAll();
    await vi.waitFor(() => expect(gateway.ofOp(6)).toHaveLength(1), { timeout: 5000 });
    expect(gateway.ofOp(6)[0]!.d).toMatchObject({ token: BOT_TOKEN, session_id: 'session-1' });
    expect(gateway.ofOp(2)).toHaveLength(1);
    await vi.waitFor(() => expect(client.status().state).toBe('connected'));
  });

  it('reconnects when Discord asks it to', async () => {
    gateway = await startFakeGateway();
    const { client } = connect();
    await vi.waitFor(() => expect(client.status().state).toBe('connected'));
    gateway.sendAll({ op: 7 });
    await vi.waitFor(() => expect(gateway.ofOp(6)).toHaveLength(1), { timeout: 5000 });
  });

  it('gives up with an explanation when a privileged intent is switched off, or the token is wrong', async () => {
    gateway = await startFakeGateway();
    const { client } = connect();
    await vi.waitFor(() => expect(client.status().state).toBe('connected'));
    gateway.closeAll(4014);
    await vi.waitFor(() => expect(client.status().state).toBe('error'));
    expect(client.status().message).toContain('Message Content Intent');
    // It does not keep trying.
    await new Promise((r) => setTimeout(r, 1500));
    expect(gateway.ofOp(2)).toHaveLength(1);
    expect(gateway.connections()).toBe(0);

    const second = connect();
    await vi.waitFor(() => expect(second.client.status().state).toBe('connected'));
    gateway.closeAll(4004);
    await vi.waitFor(() => expect(second.client.status().message).toContain('rejected the bot token'));
  });

  it('reconnects when Discord stops answering heartbeats', async () => {
    gateway = await startFakeGateway({ heartbeatMs: 80, ack: false });
    const { client } = connect();
    await vi.waitFor(() => expect(client.status().state).toBe('connected'));
    await vi.waitFor(() => expect(gateway.ofOp(6).length).toBeGreaterThan(0), { timeout: 6000 });
  });

  it('stops cleanly', async () => {
    gateway = await startFakeGateway();
    const { client } = connect();
    await vi.waitFor(() => expect(client.status().state).toBe('connected'));
    client.stop();
    expect(client.status().state).toBe('off');
    await vi.waitFor(() => expect(gateway.connections()).toBe(0));
  });
});

describe('the bot on the gateway', () => {
  let rest: Awaited<ReturnType<typeof startFakeRest>>;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;

  const settings = (over: Record<string, unknown> = {}) => ({
    enabled: true,
    applicationId: APP,
    publicKey: PUBLIC_KEY,
    botToken: BOT_TOKEN,
    guildId: GUILD,
    publicInfo: false,
    eventsChannelId: EVENTS,
    logChannelId: null,
    logMinLevel: 'error',
    notifyBans: true,
    notifySignals: true,
    notifyServer: true,
    notifyJoins: false,
    gatewayEnabled: true,
    presenceEnabled: true,
    statusChannelId: STATUS_CHANNEL,
    ...over,
  });

  beforeEach(async () => {
    rest = await startFakeRest(BOT_TOKEN);
    gateway = await startFakeGateway();
    ctx = await createTestApp();
    ctx.services.servers.savePrimary({ name: 'Dev', adapter: 'mock', host: '', port: 8212, username: 'admin' });
    await ctx.services.players.refreshOnline();
    ctx.services.discordBot.setApiBase(rest.url, gateway.url);
    await ctx.services.users.create({ username: 'admin-user', password: 'correct-horse-battery', role: 'admin', discord: { id: ADMIN_DISCORD, username: 'admin', avatar: null } });
  });
  afterEach(async () => {
    ctx.services.discordBot.stop();
    await rest.close();
  });

  const setup = async (over: Record<string, unknown> = {}) => {
    const owner = await loginAs(ctx.app, ctx.services, 'owner');
    expect((await api(ctx.app, { method: 'PUT', url: '/api/v1/discord-bot/settings', cookie: owner, payload: settings(over) })).statusCode).toBe(200);
    await vi.waitFor(() => expect(ctx.services.discordBot.gatewayStatus().state).toBe('connected'));
    rest.calls.length = 0;
    return owner;
  };
  const latest = () => gateway.presences().at(-1);

  it('connects when enabled, and not when the gateway is switched off', async () => {
    const owner = await setup();
    expect(gateway.ofOp(2)[0]!.d.intents).toBe(Intents.Guilds | Intents.GuildModeration | Intents.GuildMessages);
    await api(ctx.app, { method: 'PUT', url: '/api/v1/discord-bot/settings', cookie: owner, payload: settings({ gatewayEnabled: false }) });
    await vi.waitFor(() => expect(ctx.services.discordBot.gatewayStatus().state).toBe('off'));
    await vi.waitFor(() => expect(gateway.connections()).toBe(0));
    const settingsView = (await api(ctx.app, { method: 'GET', url: '/api/v1/discord-bot/settings', cookie: owner })).json();
    expect(settingsView.gateway.state).toBe('off');
  });

  it('shows the player count, and "do not disturb" when the server is offline', async () => {
    await setup();
    const bot = ctx.services.discordBot;
    expect(latest()).toMatchObject({ status: 'idle' });
    await bot.checkServer();
    await vi.waitFor(() => expect(latest()).toMatchObject({ status: 'online', activities: [{ name: '3/32 players', type: 3 }] }));

    ctx.services.palworld.mock.shutdown();
    await bot.checkServer();
    // One missed check is a blip; the second makes it real.
    expect(latest()).toMatchObject({ status: 'online' });
    await bot.checkServer();
    await vi.waitFor(() => expect(latest()).toMatchObject({ status: 'dnd', activities: [{ name: 'Server offline' }] }));

    ctx.services.palworld.mock.start();
    await bot.checkServer();
    await vi.waitFor(() => expect(latest()).toMatchObject({ status: 'online' }));
  });

  it('shows "restarting" from the moment a shutdown is ordered until the server is back', async () => {
    const owner = await setup();
    const bot = ctx.services.discordBot;
    await bot.checkServer();
    await api(ctx.app, { method: 'POST', url: '/api/v1/server/shutdown', cookie: owner, payload: { waitSeconds: 30, message: 'Restarting' } });
    await vi.waitFor(() => expect(latest()).toMatchObject({ status: 'dnd', activities: [{ name: 'Server restarting' }] }));
    // Still counting down: the server is up, but it stays "restarting".
    await bot.checkServer();
    expect(latest()).toMatchObject({ activities: [{ name: 'Server restarting' }] });
    // It goes down (mock shutdown stops it) and the "offline" announcement is not made for a planned restart.
    await bot.checkServer();
    await bot.checkServer();
    expect(latest()).toMatchObject({ activities: [{ name: 'Server restarting' }] });
    ctx.services.palworld.mock.start();
    await bot.checkServer();
    await vi.waitFor(() => expect(latest()).toMatchObject({ status: 'online', activities: [{ name: '3/32 players' }] }));
    const messages = rest.calls.filter((c) => c.path === `/channels/${EVENTS}/messages`).map((c) => String(c.body?.content));
    await vi.waitFor(() => expect(rest.calls.filter((c) => c.path === `/channels/${EVENTS}/messages`).map((c) => String(c.body?.content)).join('\n')).toContain('shutting down or restarting'));
    expect(messages.join('\n')).not.toContain('The server is offline');
  });

  it('leaves the activity out when the status is switched off', async () => {
    await setup({ presenceEnabled: false });
    await ctx.services.discordBot.checkServer();
    await new Promise((r) => setTimeout(r, 300));
    expect(gateway.presences().every((p) => p.activities.length === 0)).toBe(true);
  });

  it('renames the status channel, at most every six minutes', async () => {
    await setup();
    const bot = ctx.services.discordBot;
    const renames = () => rest.calls.filter((c) => c.method === 'PATCH' && c.path === `/channels/${STATUS_CHANNEL}`);
    await bot.checkServer();
    await vi.waitFor(() => expect(renames()).toHaveLength(1));
    expect(renames()[0]!.body).toEqual({ name: '🟢 3/32 online' });

    // A change right away waits: Discord allows only about two renames per ten minutes.
    ctx.services.palworld.mock.shutdown();
    await bot.checkServer();
    await bot.checkServer();
    await new Promise((r) => setTimeout(r, 300));
    expect(renames()).toHaveLength(1);

    // Once the wait has passed, the held-back name goes through on the next check, with no new change needed.
    ctx.services.db.prepare(`UPDATE discord_bot SET status_channel_changed_at = ?`).run(new Date(Date.now() - 7 * 60 * 1000).toISOString());
    await bot.checkServer();
    await vi.waitFor(() => expect(renames()).toHaveLength(2));
    expect(renames()[1]!.body).toEqual({ name: '🔴 offline' });
    // And nothing more is sent while it already matches.
    await bot.checkServer();
    await new Promise((r) => setTimeout(r, 200));
    expect(renames()).toHaveLength(2);
  });

  it('answers slash commands that arrive over the gateway, without a public URL', async () => {
    await setup();
    gateway.dispatchAll('INTERACTION_CREATE', {
      id: 'int-1',
      type: 2,
      token: 'itoken',
      application_id: APP,
      guild_id: GUILD,
      member: { user: { id: ADMIN_DISCORD } },
      data: { name: 'status', options: [] },
    });
    await vi.waitFor(() => expect(rest.calls.some((c) => c.path === '/interactions/int-1/itoken/callback')).toBe(true));
    const callback = rest.calls.find((c) => c.path === '/interactions/int-1/itoken/callback')!;
    expect(callback.method).toBe('POST');
    expect(callback.body).toEqual({ type: 5, data: { flags: 64 } });
    await ctx.services.discordBot.idle();
    await vi.waitFor(() => expect(rest.calls.some((c) => c.method === 'PATCH' && c.path.endsWith('/messages/@original'))).toBe(true));
  });
});
