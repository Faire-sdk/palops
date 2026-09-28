import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileChatPattern, DEFAULT_CHAT_PATTERN, fitForGame, parseChatLine, PatternError, plainDiscordText } from '../src/services/discord/chat-relay.js';
import { Intents } from '../src/services/discord/gateway.js';
import { api, createTestApp, loginAs } from './helpers.js';
import { startFakeGateway, startFakeRest } from './fake-discord.js';

const BOT_TOKEN = 'bot-token-abc.def';
const APP = '111111111111111111';
const GUILD = '222222222222222222';
const RELAY = '888888888888888888';
const PD_TOKEN = 'pd-token';

let rest: Awaited<ReturnType<typeof startFakeRest>>;
let gateway: Awaited<ReturnType<typeof startFakeGateway>>;
let pd: Server;
let pdCalls: Array<{ path: string; body: Record<string, unknown> }> = [];
let pdFail = false;
let ctx: Awaited<ReturnType<typeof createTestApp>>;

beforeAll(async () => {
  pd = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const path = (req.url ?? '').replace('/v1/pdapi/', '');
      pdCalls.push({ path, body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {} });
      if (pdFail) return res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ Error: { Code: 'REQUEST_TIMEOUT', Message: 'slow' } }));
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ Success: true }));
    });
  });
  await new Promise<void>((r) => pd.listen(0, '127.0.0.1', r));
});
afterAll(() => new Promise<void>((r) => pd.close(() => r())));

const settings = (over: Record<string, unknown> = {}) => ({
  enabled: true,
  applicationId: APP,
  publicKey: 'a'.repeat(64),
  botToken: BOT_TOKEN,
  guildId: GUILD,
  publicInfo: false,
  eventsChannelId: null,
  logChannelId: null,
  logMinLevel: 'error',
  notifyBans: false,
  notifySignals: false,
  notifyServer: false,
  notifyJoins: false,
  gatewayEnabled: true,
  presenceEnabled: false,
  statusChannelId: null,
  joinOnLogin: false,
  verifiedRoleId: null,
  roleOwnerId: null,
  roleAdminId: null,
  roleModeratorId: null,
  syncNicknames: false,
  syncBans: false,
  relayEnabled: true,
  relayChannelId: RELAY,
  relayToDiscord: true,
  relayToGame: true,
  relayPattern: null,
  relaySources: ['game'],
  relayPrefix: 'Discord',
  ...over,
});

beforeEach(async () => {
  pdCalls = [];
  pdFail = false;
  rest = await startFakeRest(BOT_TOKEN);
  gateway = await startFakeGateway();
  ctx = await createTestApp();
  ctx.services.servers.savePrimary({ name: 'Dev', adapter: 'mock', host: '', port: 8212, username: 'admin' });
  await ctx.services.players.refreshOnline();
  ctx.services.discordBot.setApiBase(rest.url, gateway.url);
});
afterEach(async () => {
  ctx.services.discordBot.stop();
  await gateway.close();
  await rest.close();
});

async function enable(over: Record<string, unknown> = {}) {
  const owner = await loginAs(ctx.app, ctx.services, 'owner');
  const res = await api(ctx.app, { method: 'PUT', url: '/api/v1/discord-bot/settings', cookie: owner, payload: settings(over) });
  expect(res.statusCode, res.body).toBe(200);
  await vi.waitFor(() => expect(ctx.services.discordBot.gatewayStatus().state).toBe('connected'));
  rest.calls.length = 0;
  return owner;
}
const relayPosts = () => rest.calls.filter((c) => c.method === 'POST' && c.path === `/channels/${RELAY}/messages`).map((c) => c.body as { content: string; allowed_mentions: unknown });
const chat = (source: 'game' | 'paldefender' | 'panel', line: string) => {
  ctx.services.console.add(source, line);
  ctx.services.console.flush();
};
const message = (over: Record<string, unknown> = {}) => ({
  id: 'm1',
  type: 0,
  channel_id: RELAY,
  guild_id: GUILD,
  content: 'hello there',
  author: { id: '600000000000000001', username: 'bob', global_name: 'Bob' },
  mentions: [],
  ...over,
});
const send = (over: Record<string, unknown> = {}) => gateway.dispatchAll('MESSAGE_CREATE', message(over));
const announced = () => ctx.services.palworld.mock.announcements;

describe('reading chat from console lines', () => {
  it('finds the player and message with the default pattern', () => {
    const re = compileChatPattern(DEFAULT_CHAT_PATTERN);
    expect(parseChatLine(re, '[2026-09-28 12:00:00] [CHAT] <Anubis> hello everyone')).toEqual({ player: 'Anubis', message: 'hello everyone' });
    expect(parseChatLine(re, '[2026-09-28 12:00:00] [CHAT] <Big Name> spaces  and <angles>')).toEqual({ player: 'Big Name', message: 'spaces  and <angles>' });
    expect(parseChatLine(re, 'LogNet: something else')).toBeNull();
    expect(parseChatLine(re, '[2026-09-28 12:00:00] [CHAT] <Anubis>')).toBeNull();
  });

  it('accepts a custom pattern only if it names the player and message, and is safe', () => {
    expect(parseChatLine(compileChatPattern('^\\[Chat\\] (?<player>.+?): (?<message>.+)$'), '[Chat] Anubis: hi')).toEqual({ player: 'Anubis', message: 'hi' });
    expect(() => compileChatPattern('(unclosed')).toThrow(PatternError);
    expect(() => compileChatPattern('^(.+)$')).toThrow('named groups');
    expect(() => compileChatPattern('^(?<player>(a+)+)(?<message>.+)$')).toThrow('repeats a repeat');
    expect(() => compileChatPattern(`^(?<player>a)(?<message>${'b'.repeat(400)})$`)).toThrow('under 300');
  });

  it('cleans Discord markup for the game and fits it to the announcement limit', () => {
    const text = plainDiscordText({
      content: 'hey <@42> and <@&7> in <#9> <:lul:123> <a:dance:456>\nnew   line https://example.com/a/very/long/link/that/keeps/going/and/going',
      mentions: [{ id: '42', username: 'carol', global_name: 'Carol' }],
    });
    expect(text).toBe('hey @Carol and @role in #channel :lul: :dance: new line https://example.com/a/very/long/link/...');
    expect(plainDiscordText({ content: '  ', attachments: [{}] })).toBe('[attachment]');
    expect(plainDiscordText({ content: '\u0007\u0000bell' })).toBe('bell');
    expect(fitForGame('short')).toBe('short');
    const long = fitForGame(`${'word '.repeat(60)}`);
    expect(long.length).toBeLessThanOrEqual(200);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('chat relay settings', () => {
  it('check a pattern against a sample line, and refuse a bad one when saving', async () => {
    const owner = await enable();
    const test = (pattern: string | null, line: string) => api(ctx.app, { method: 'POST', url: '/api/v1/discord-bot/relay/test', cookie: owner, payload: { pattern, line } }).then((r) => r.json());
    expect(await test(null, '[2026-09-28 12:00:00] [CHAT] <Anubis> hi')).toEqual({ matched: true, player: 'Anubis', message: 'hi', error: null });
    expect(await test(null, 'not chat')).toMatchObject({ matched: false, error: null });
    expect(await test('^(.+)$', 'x')).toMatchObject({ matched: false, error: expect.stringContaining('named groups') });

    const bad = await api(ctx.app, { method: 'PUT', url: '/api/v1/discord-bot/settings', cookie: owner, payload: settings({ relayPattern: '^(.+)$' }) });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('invalid_pattern');
    const noChannel = await api(ctx.app, { method: 'PUT', url: '/api/v1/discord-bot/settings', cookie: owner, payload: settings({ relayChannelId: null }) });
    expect(noChannel.statusCode).toBe(400);
    const admin = await loginAs(ctx.app, ctx.services, 'admin');
    expect((await api(ctx.app, { method: 'POST', url: '/api/v1/discord-bot/relay/test', cookie: admin, payload: { pattern: null, line: 'x' } })).statusCode).toBe(403);
  });

  it('ask for the privileged message-content intent only when Discord messages are read', async () => {
    await enable();
    expect(gateway.ofOp(2)[0]!.d.intents & Intents.MessageContent).toBe(Intents.MessageContent);
    ctx.services.discordBot.stop();
    const owner = await enable({ relayToGame: false });
    expect(gateway.ofOp(2).at(-1)!.d.intents & Intents.MessageContent).toBe(0);
    await api(ctx.app, { method: 'PUT', url: '/api/v1/discord-bot/settings', cookie: owner, payload: settings({ relayEnabled: false }) });
    await vi.waitFor(() => expect(gateway.ofOp(2).at(-1)!.d.intents & Intents.MessageContent).toBe(0));
  });
});

describe('game chat to Discord', () => {
  it('posts chat lines to the channel with the name in bold, and nothing that is not chat', async () => {
    await enable();
    chat('game', '[2026-09-28 12:00:00] [CHAT] <Anubis> hello @everyone *wave*');
    chat('game', 'LogPal: Autosave complete');
    await vi.waitFor(() => expect(relayPosts()).toHaveLength(1), { timeout: 3000 });
    expect(relayPosts()[0]!.content).toBe('**Anubis**: hello \\@everyone \\*wave\\*');
    expect(relayPosts()[0]!.allowed_mentions).toEqual({ parse: [] });
  });

  it('follows the chosen sources and a custom pattern', async () => {
    await enable({ relaySources: ['paldefender'], relayPattern: '^\\[Chat\\] (?<player>.+?): (?<message>.+)$' });
    chat('game', '[Chat] Anubis: from the game log');
    chat('paldefender', '[Chat] Lamball: from PalDefender');
    chat('panel', '[Chat] Panel: ignored');
    await vi.waitFor(() => expect(relayPosts()).toHaveLength(1), { timeout: 3000 });
    expect(relayPosts()[0]!.content).toBe('**Lamball**: from PalDefender');
  });

  it('can be switched to one direction only', async () => {
    await enable({ relayToDiscord: false });
    chat('game', '[2026-09-28 12:00:00] [CHAT] <Anubis> hi');
    await new Promise((r) => setTimeout(r, 700));
    expect(relayPosts()).toEqual([]);
  });

  it('does not send Discord messages that were relayed into the game back to Discord', async () => {
    await enable();
    send({ content: 'hello from discord' });
    await vi.waitFor(() => expect(announced()).toHaveLength(1));
    // The game logs the announcement, as a marked line or as plain text.
    chat('game', '[2026-09-28 12:00:01] [CHAT] <Server> [Discord] Bob: hello from discord');
    chat('game', '[2026-09-28 12:00:02] [CHAT] <Server> hello from discord');
    chat('game', '[2026-09-28 12:00:03] [CHAT] <Anubis> a real message');
    await vi.waitFor(() => expect(relayPosts()).toHaveLength(1), { timeout: 3000 });
    expect(relayPosts()[0]!.content).toBe('**Anubis**: a real message');
  });
});

describe('Discord chat to the game', () => {
  it('announces the message with the prefix and the sender’s name', async () => {
    await enable({ relayPrefix: 'Discord' });
    send({ content: 'hello there', member: { nick: 'Bobby' } });
    await vi.waitFor(() => expect(announced()).toEqual(['[Discord] Bobby: hello there']));
    send({ id: 'm2', content: 'no nick', member: { nick: null }, author: { id: '600000000000000002', username: 'carol', global_name: null } });
    await vi.waitFor(() => expect(announced()).toContain('[Discord] carol: no nick'));
  });

  it('turns mentions and emoji into plain text, and truncates to the game limit', async () => {
    await enable();
    send({ content: 'thanks <@7> :) <:cat:1>', mentions: [{ id: '7', username: 'dave', global_name: 'Dave' }] });
    await vi.waitFor(() => expect(announced()).toEqual(['[Discord] Bob: thanks @Dave :) :cat:']));
    send({ id: 'm2', content: 'word '.repeat(80) });
    await vi.waitFor(() => expect(announced()).toHaveLength(2));
    expect(announced()[1]!.length).toBeLessThanOrEqual(200);
  });

  it('ignores bots, webhooks, other channels, other servers, system messages and empty text', async () => {
    await enable();
    send({ id: 'a', author: { id: '1', username: 'bot', bot: true } });
    send({ id: 'b', webhook_id: '5' });
    send({ id: 'c', channel_id: '999999999999999999' });
    send({ id: 'd', guild_id: '999999999999999999' });
    send({ id: 'e', type: 7 });
    send({ id: 'f', content: '   ' });
    send({ id: 'g', content: 'the only real one' });
    await vi.waitFor(() => expect(announced()).toEqual(['[Discord] Bob: the only real one']));
  });

  it('is off when switched off or set to game-to-Discord only', async () => {
    await enable({ relayToGame: false });
    send();
    await new Promise((r) => setTimeout(r, 400));
    expect(announced()).toEqual([]);
  });

  it('slows down someone who floods the channel', async () => {
    await enable();
    for (let i = 0; i < 9; i++) send({ id: `m${i}`, content: `msg ${i}` });
    await vi.waitFor(() => expect(announced().length).toBe(5), { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 300));
    expect(announced()).toHaveLength(5);
  });

  it('does not relay someone whose verified character is banned in game', async () => {
    await enable();
    const acc = ctx.services.siteAccounts.signIn({ id: '600000000000000001', username: 'bob', avatar: null });
    ctx.services.siteAccounts.linkPlayer(acc.id, ctx.services.players.find('Anubis')[0]!.id);
    ctx.services.siteAccounts.verify(acc.id, 'staff');
    await ctx.services.moderation.ban({ userId: null, username: 't' }, 'steam_76561190000000002', 'x');
    send({ content: 'let me talk' });
    await new Promise((r) => setTimeout(r, 400));
    expect(announced()).toEqual([]);
  });

  it('uses PalDefender’s chat broadcast when it is on, and falls back to the server announcement if that fails', async () => {
    ctx.services.paldefender.save({ enabled: true, host: '127.0.0.1', port: (pd.address() as AddressInfo).port, useTls: false, token: PD_TOKEN });
    await enable();
    send({ content: 'via paldefender' });
    await vi.waitFor(() => expect(pdCalls.some((c) => c.path === 'Broadcast')).toBe(true));
    expect(pdCalls.find((c) => c.path === 'Broadcast')!.body).toEqual({ Message: '[Discord] Bob: via paldefender' });
    expect(announced()).toEqual([]);

    pdFail = true;
    send({ id: 'm2', content: 'fallback' });
    await vi.waitFor(() => expect(announced()).toEqual(['[Discord] Bob: fallback']));
  });
});
