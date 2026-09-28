import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscordAccount } from '../src/services/authentication/users.js';
import type { Interaction } from '../src/services/discord/interactions.js';
import { api, createTestApp, loginAs } from './helpers.js';
import { startFakeGateway, startFakeRest } from './fake-discord.js';

const BOT_TOKEN = 'bot-token-abc.def';
const APP = '111111111111111111';
const GUILD = '222222222222222222';
const EVENTS = '333333333333333333';
const VERIFIED_ROLE = '700000000000000001';
const OWNER_ROLE = '700000000000000002';
const ADMIN_ROLE = '700000000000000003';
const MOD_ROLE = '700000000000000004';
const OTHER_ROLE = '700000000000000009';
const PD_TOKEN = 'pd-token';

const LAMBALL = 'steam_76561190000000001';
const ANUBIS = 'steam_76561190000000002';
const PLAYER_ONE: DiscordAccount = { id: '333333333333333331', username: 'lambfan', avatar: null };
const PLAYER_TWO: DiscordAccount = { id: '333333333333333332', username: 'impostor', avatar: null };
const PLAYER_THREE: DiscordAccount = { id: '333333333333333333', username: 'anubisfan', avatar: null };
const OWNER_D = '555555555555555551';
const ADMIN_D = '555555555555555552';
const MOD_D = '555555555555555553';

let rest: Awaited<ReturnType<typeof startFakeRest>>;
let gateway: Awaited<ReturnType<typeof startFakeGateway>> | undefined;
let pd: Server;
let pdCalls: Array<{ path: string; body: Record<string, unknown> }> = [];
let pdFail = false;
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let nextAccount: DiscordAccount & { accessToken?: string };
let authorizeOptions: Array<{ joinServer?: boolean } | undefined> = [];

beforeAll(async () => {
  pd = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const path = (req.url ?? '').replace('/v1/pdapi/', '');
      if (req.headers.authorization !== `Bearer ${PD_TOKEN}`) return res.writeHead(401).end('{}');
      pdCalls.push({ path, body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {} });
      if (pdFail) return res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ Error: { Code: 'SEND_MESSAGE_FAILED', Message: 'nope' } }));
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ Success: true, SentCount: 1 }));
    });
  });
  await new Promise<void>((r) => pd.listen(0, '127.0.0.1', r));
});
afterAll(() => new Promise<void>((r) => pd.close(() => r())));

const botSettings = (over: Record<string, unknown> = {}) => ({
  enabled: true,
  applicationId: APP,
  publicKey: 'a'.repeat(64),
  botToken: BOT_TOKEN,
  guildId: GUILD,
  publicInfo: false,
  eventsChannelId: EVENTS,
  logChannelId: null,
  logMinLevel: 'error',
  notifyBans: true,
  notifySignals: false,
  notifyServer: false,
  notifyJoins: false,
  gatewayEnabled: false,
  presenceEnabled: false,
  statusChannelId: null,
  joinOnLogin: false,
  verifiedRoleId: VERIFIED_ROLE,
  roleOwnerId: OWNER_ROLE,
  roleAdminId: ADMIN_ROLE,
  roleModeratorId: MOD_ROLE,
  syncNicknames: false,
  syncBans: false,
  ...over,
});

beforeEach(async () => {
  pdCalls = [];
  pdFail = false;
  authorizeOptions = [];
  rest = await startFakeRest(BOT_TOKEN);
  ctx = await createTestApp({ DISCORD_CLIENT_ID: '123456789012345678', DISCORD_CLIENT_SECRET: 'shh', DISCORD_REDIRECT_URI: 'https://panel.example/api/v1/auth/discord/callback', AUTH_PASSWORD_LOGIN: 'true' });
  ctx.services.discordOAuth = {
    authorizeUrl: (state, options) => (authorizeOptions.push(options), `https://discord.com/oauth2/authorize?state=${state}`),
    exchange: async () => nextAccount,
  };
  ctx.services.servers.savePrimary({ name: 'Dev', adapter: 'mock', host: '', port: 8212, username: 'admin' });
  await ctx.services.players.refreshOnline();
  ctx.services.discordBot.setApiBase(rest.url);
  for (const [username, role, id] of [['owner-user', 'owner', OWNER_D], ['admin-user', 'admin', ADMIN_D], ['moderator-user', 'moderator', MOD_D]] as const) {
    await ctx.services.users.create({ username, password: 'correct-horse-battery', role, discord: { id, username, avatar: null } });
  }
});
afterEach(async () => {
  ctx.services.discordBot.stop();
  await gateway?.close();
  gateway = undefined;
  await rest.close();
});

const put = (cookie: string, url: string, payload: Record<string, unknown>) => api(ctx.app, { method: 'PUT', url, cookie, payload });
const post = (cookie: string, url: string, payload: Record<string, unknown> = {}) => api(ctx.app, { method: 'POST', url, cookie, payload });
const get = (cookie: string, url: string) => api(ctx.app, { method: 'GET', url, cookie });
const del = (cookie: string, url: string) => api(ctx.app, { method: 'DELETE', url, cookie });

async function playerSignIn(account: DiscordAccount) {
  nextAccount = { ...account, accessToken: 'user-access-token' };
  const start = await post('', '/api/v1/auth/discord/authorize', { intent: 'player' });
  const state = new URL(start.json().url).searchParams.get('state')!;
  const res = await ctx.app.inject({ method: 'GET', url: `/api/v1/auth/discord/callback?code=c&state=${state}`, headers: { cookie: `palops_oauth_state=${state}` } });
  expect(res.headers.location).toBe('/account');
  return `palops_player=${res.cookies.find((c) => c.name === 'palops_player')!.value}`;
}
const link = (cookie: string, query: string) => post(cookie, '/api/v1/site/link', { query });
const enableBot = async (over: Record<string, unknown> = {}) => {
  const owner = await loginAs(ctx.app, ctx.services, 'owner');
  expect((await put(owner, '/api/v1/discord-bot/settings', botSettings(over))).statusCode).toBe(200);
  rest.calls.length = 0;
  return owner;
};
const enablePalDefender = () => ctx.services.paldefender.save({ enabled: true, host: '127.0.0.1', port: (pd.address() as AddressInfo).port, useTls: false, token: PD_TOKEN });
const inGuild = (id: string, roles: string[] = []) => rest.members.set(`${GUILD}/${id}`, { roles });
const rolesOf = (id: string) => rest.members.get(`${GUILD}/${id}`)?.roles.slice().sort();

describe('verifying a character link', () => {
  it('sends a code in the game and verifies when it is typed back', async () => {
    enablePalDefender();
    const cookie = await playerSignIn(PLAYER_ONE);
    await link(cookie, 'Lamball Enjoyer');
    const me = (await get(cookie, '/api/v1/site/me')).json();
    expect(me.character).toMatchObject({ verified: false, verification: { inGameCode: true, codePending: false } });

    const sent = await post(cookie, '/api/v1/site/verify/code');
    expect(sent.json()).toEqual({ sent: true, expiresInMinutes: 10 });
    const message = pdCalls.find((c) => c.path === 'SendPlayerMessage')!;
    expect(message.body).toMatchObject({ SendType: 'PlayerChat', UserID: LAMBALL });
    const code = /code: ([A-Z0-9]{6})/.exec(String(message.body.Message))![1]!;
    expect(code).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);

    const wrong = await post(cookie, '/api/v1/site/verify/confirm', { code: 'AAAAAA' });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.code).toBe('wrong_code');
    const ok = await post(cookie, '/api/v1/site/verify/confirm', { code: ` ${code.toLowerCase().slice(0, 3)}-${code.slice(3)} ` });
    expect(ok.json().character).toMatchObject({ verified: true, verifiedBy: 'in-game code' });
    expect(ctx.services.audit.list({ category: 'players', limit: 3, offset: 0 }).entries.map((e) => e.action)).toContain('character_verified');
    // The stored code is a hash, and it's gone once used.
    expect(JSON.stringify(ctx.services.db.prepare('SELECT * FROM link_codes').all())).not.toContain(code);
    expect((await post(cookie, '/api/v1/site/verify/confirm', { code })).json().error.code).toBe('no_code');
  });

  it('locks a code after too many wrong guesses, and refuses expired ones', async () => {
    enablePalDefender();
    const cookie = await playerSignIn(PLAYER_ONE);
    await link(cookie, 'Lamball Enjoyer');
    await post(cookie, '/api/v1/site/verify/code');
    const code = /code: ([A-Z0-9]{6})/.exec(String(pdCalls.at(-1)!.body.Message))![1]!;
    for (let i = 0; i < 5; i++) expect((await post(cookie, '/api/v1/site/verify/confirm', { code: 'ZZZZZZ' })).statusCode).toBe(400);
    // The right code no longer works once locked.
    expect((await post(cookie, '/api/v1/site/verify/confirm', { code })).statusCode).toBe(429);

    ctx.services.db.prepare(`UPDATE link_codes SET sent_at = '2020-01-01T00:00:00Z', attempts = 0`).run();
    await post(cookie, '/api/v1/site/verify/code');
    const fresh = /code: ([A-Z0-9]{6})/.exec(String(pdCalls.at(-1)!.body.Message))![1]!;
    ctx.services.db.prepare(`UPDATE link_codes SET expires_at = '2020-01-01T00:00:00Z'`).run();
    const expired = await post(cookie, '/api/v1/site/verify/confirm', { code: fresh });
    expect(expired.json().error.code).toBe('code_expired');
  });

  it('will not send codes too fast, to offline players, without PalDefender, or when delivery fails', async () => {
    const cookie = await playerSignIn(PLAYER_ONE);
    await link(cookie, 'Anubis');
    expect((await post(cookie, '/api/v1/site/verify/code')).statusCode).toBe(409);
    expect((await post(cookie, '/api/v1/site/verify/code')).json().error.message).toContain('aren’t available');

    enablePalDefender();
    pdFail = true;
    const failed = await post(cookie, '/api/v1/site/verify/code');
    expect(failed.statusCode).toBe(409);
    expect(failed.json().error.message).toContain('couldn’t be delivered');
    // A code that never reached the player isn't left behind.
    expect((await post(cookie, '/api/v1/site/verify/confirm', { code: 'ABCDEF' })).json().error.code).toBe('no_code');

    pdFail = false;
    expect((await post(cookie, '/api/v1/site/verify/code')).statusCode).toBe(200);
    expect((await post(cookie, '/api/v1/site/verify/code')).statusCode).toBe(429);

    await ctx.services.palworld.mock.kick(ANUBIS);
    ctx.services.players.markAllOffline();
    ctx.services.db.prepare(`UPDATE link_codes SET sent_at = '2020-01-01T00:00:00Z'`).run();
    const offline = await post(cookie, '/api/v1/site/verify/code');
    expect(offline.statusCode).toBe(409);
    expect(offline.json().error.message).toContain('Join the server');
    expect((await post(await playerSignIn(PLAYER_TWO), '/api/v1/site/verify/code')).statusCode).toBe(400);
  });

  it('lets staff verify a link on request, and reject or unlink it', async () => {
    const cookie = await playerSignIn(PLAYER_ONE);
    await link(cookie, 'Lamball Enjoyer');
    expect((await post(cookie, '/api/v1/site/verify/request')).json().character.verification.requestedAt).not.toBeNull();

    const mod = await loginAs(ctx.app, ctx.services, 'moderator');
    expect((await get(mod, '/api/v1/players/link-requests')).statusCode).toBe(403);
    const admin = await loginAs(ctx.app, ctx.services, 'admin');
    const requests = (await get(admin, '/api/v1/players/link-requests')).json().requests;
    expect(requests).toMatchObject([{ discord: { username: 'lambfan' }, player: { name: 'Lamball Enjoyer', userId: LAMBALL } }]);

    const approved = await post(admin, `/api/v1/players/link-requests/${requests[0].accountId}/approve`);
    expect(approved.statusCode).toBe(200);
    expect((await get(cookie, '/api/v1/site/me')).json().character).toMatchObject({ verified: true, verifiedBy: 'staff' });
    const profile = (await get(admin, `/api/v1/players/${LAMBALL}`)).json();
    expect(profile.link).toMatchObject({ discord: { username: 'lambfan' }, verified: true, verifiedBy: 'admin-user' });
    expect((await get(admin, '/api/v1/players/link-requests')).json().requests).toEqual([]);

    expect((await del(admin, `/api/v1/players/${LAMBALL}/link`)).statusCode).toBe(200);
    expect((await get(cookie, '/api/v1/site/me')).json().character).toBeNull();

    // Rejecting drops an unverified claim.
    const other = await playerSignIn(PLAYER_TWO);
    await link(other, 'Anubis');
    await post(other, '/api/v1/site/verify/request');
    const [pending] = (await get(admin, '/api/v1/players/link-requests')).json().requests;
    await post(admin, `/api/v1/players/link-requests/${pending.accountId}/reject`);
    expect((await get(other, '/api/v1/site/me')).json().character).toBeNull();
    // Staff can also verify straight from a player's profile.
    await link(other, 'Anubis');
    expect((await post(admin, `/api/v1/players/${ANUBIS}/link/verify`)).statusCode).toBe(200);
    expect((await get(other, '/api/v1/site/me')).json().character.verified).toBe(true);
    expect((await post(admin, `/api/v1/players/${LAMBALL}/link/verify`)).statusCode).toBe(404);
  });

  it('keeps the Discord name private unless the player chooses to show it', async () => {
    const cookie = await playerSignIn(PLAYER_ONE);
    expect((await get(cookie, '/api/v1/site/me')).json().privacy).toEqual({ showDiscord: false });
    expect((await post(cookie, '/api/v1/site/privacy', { showDiscord: true })).json().privacy).toEqual({ showDiscord: true });
  });
});

describe('roles and nicknames', () => {
  it('give the verified role when a link is verified, and take it away when it is removed', async () => {
    await enableBot();
    inGuild(PLAYER_ONE.id, [OTHER_ROLE]);
    const cookie = await playerSignIn(PLAYER_ONE);
    await link(cookie, 'Lamball Enjoyer');
    await ctx.services.discordBot.idle();
    // A claim alone earns nothing.
    expect(rolesOf(PLAYER_ONE.id)).toEqual([OTHER_ROLE]);

    ctx.services.siteAccounts.verify(ctx.services.siteAccounts.getByDiscordId(PLAYER_ONE.id)!.id, 'staff');
    await ctx.services.discordBot.idle();
    expect(rolesOf(PLAYER_ONE.id)).toEqual([VERIFIED_ROLE, OTHER_ROLE].sort());

    await post(cookie, '/api/v1/site/unlink');
    await ctx.services.discordBot.idle();
    // Only the roles PalOps manages are touched.
    expect(rolesOf(PLAYER_ONE.id)).toEqual([OTHER_ROLE]);
  });

  it('follow a panel user’s role, including when it changes or they are disabled', async () => {
    await enableBot();
    inGuild(ADMIN_D);
    inGuild(MOD_D, [ADMIN_ROLE]);
    ctx.services.users.update(ctx.services.users.findByDiscordId(ADMIN_D)!.id, { role: 'moderator' });
    ctx.services.users.update(ctx.services.users.findByDiscordId(ADMIN_D)!.id, { role: 'admin' });
    await ctx.services.discordBot.idle();
    expect(rolesOf(ADMIN_D)).toEqual([ADMIN_ROLE]);
    ctx.services.users.update(ctx.services.users.findByDiscordId(ADMIN_D)!.id, { disabled: true });
    await ctx.services.discordBot.idle();
    expect(rolesOf(ADMIN_D)).toEqual([]);

    // A new staff member gets their role as soon as they are added.
    const newId = '555555555555555560';
    inGuild(newId);
    await ctx.services.users.create({ username: 'new-mod', password: 'correct-horse-battery', role: 'moderator', discord: { id: newId, username: 'new', avatar: null } });
    await ctx.services.discordBot.idle();
    expect(rolesOf(newId)).toEqual([MOD_ROLE]);
    // Someone who isn't in the Discord server is skipped quietly.
    ctx.services.users.update(ctx.services.users.findByDiscordId(MOD_D)!.id, { role: 'admin' });
    await ctx.services.discordBot.idle();
    expect(rolesOf(MOD_D)).toEqual([ADMIN_ROLE]);
  });

  it('can set a member’s nickname to their character name', async () => {
    await enableBot({ syncNicknames: true });
    inGuild(PLAYER_ONE.id);
    const cookie = await playerSignIn(PLAYER_ONE);
    await link(cookie, 'Lamball Enjoyer');
    ctx.services.siteAccounts.verify(ctx.services.siteAccounts.getByDiscordId(PLAYER_ONE.id)!.id, 'staff');
    await ctx.services.discordBot.idle();
    expect(rest.members.get(`${GUILD}/${PLAYER_ONE.id}`)!.nick).toBe('Lamball Enjoyer');
  });

  it('do a full sync from the settings page, for owners only', async () => {
    const owner = await enableBot();
    inGuild(OWNER_D);
    inGuild(ADMIN_D);
    const cookie = await playerSignIn(PLAYER_ONE);
    await link(cookie, 'Lamball Enjoyer');
    ctx.services.siteAccounts.verify(ctx.services.siteAccounts.getByDiscordId(PLAYER_ONE.id)!.id, 'staff');
    inGuild(PLAYER_ONE.id);
    expect((await post(await loginAs(ctx.app, ctx.services, 'admin'), '/api/v1/discord-bot/sync-roles')).statusCode).toBe(403);
    const result = (await post(owner, '/api/v1/discord-bot/sync-roles')).json();
    expect(result).toEqual({ checked: 4, synced: 3, notInServer: 1, failed: 0 });
    expect(rolesOf(OWNER_D)).toEqual([OWNER_ROLE]);
    expect(rolesOf(PLAYER_ONE.id)).toEqual([VERIFIED_ROLE]);
  });
});

describe('joining the Discord server on sign-in', () => {
  it('asks for the extra permission and adds the player, with their roles', async () => {
    await enableBot({ joinOnLogin: true });
    ctx.services.siteAccounts.signIn(PLAYER_ONE);
    ctx.services.siteAccounts.linkPlayer(ctx.services.siteAccounts.getByDiscordId(PLAYER_ONE.id)!.id, ctx.services.players.find('Lamball Enjoyer')[0]!.id);
    ctx.services.siteAccounts.verify(ctx.services.siteAccounts.getByDiscordId(PLAYER_ONE.id)!.id, 'staff');
    rest.calls.length = 0;

    await playerSignIn(PLAYER_ONE);
    expect(authorizeOptions.at(-1)).toEqual({ joinServer: true });
    const join = rest.calls.find((c) => c.method === 'PUT' && c.path === `/guilds/${GUILD}/members/${PLAYER_ONE.id}`)!;
    expect(join.body).toEqual({ access_token: 'user-access-token', roles: [VERIFIED_ROLE] });
    expect(rolesOf(PLAYER_ONE.id)).toEqual([VERIFIED_ROLE]);
  });

  it('does nothing when switched off, and never blocks sign-in when Discord refuses', async () => {
    const owner = await enableBot({ joinOnLogin: false });
    await playerSignIn(PLAYER_ONE);
    expect(authorizeOptions.at(-1)).toEqual({ joinServer: false });
    expect(rest.calls.some((c) => c.path.includes('/members/'))).toBe(false);

    await put(owner, '/api/v1/discord-bot/settings', botSettings({ joinOnLogin: true }));
    rest.failing.set('/guilds/', 403);
    await playerSignIn(PLAYER_TWO);
    expect(rest.calls.some((c) => c.method === 'PUT' && c.path.includes('/members/'))).toBe(true);
  });

  it('is off for staff sign-in to the panel', async () => {
    await enableBot({ joinOnLogin: true });
    await post('', '/api/v1/auth/discord/authorize', { intent: 'login' });
    expect(authorizeOptions.at(-1)).toEqual({ joinServer: false });
  });
});

describe('keeping bans in step', () => {
  const verify = async (account: DiscordAccount, query: string) => {
    const cookie = await playerSignIn(account);
    await link(cookie, query);
    ctx.services.siteAccounts.verify(ctx.services.siteAccounts.getByDiscordId(account.id)!.id, 'staff');
    return cookie;
  };
  const bans = () => rest.calls.filter((c) => c.path.includes('/bans/'));
  const actor = { userId: null, username: 'tester' };

  it('bans a player’s verified Discord account when they are banned in game, and unbans it with them', async () => {
    await enableBot({ syncBans: true });
    await verify(PLAYER_ONE, 'Lamball Enjoyer');
    rest.calls.length = 0;
    await ctx.services.moderation.ban(actor, LAMBALL, 'Griefing');
    await vi.waitFor(() => expect(bans()).toHaveLength(1));
    expect(bans()[0]).toMatchObject({ method: 'PUT', path: `/guilds/${GUILD}/bans/${PLAYER_ONE.id}`, body: { delete_message_seconds: 0 } });
    expect(decodeURIComponent(bans()[0]!.reason!)).toContain('Griefing');

    await ctx.services.moderation.unban(actor, LAMBALL, 'Appeal');
    await vi.waitFor(() => expect(bans()).toHaveLength(2));
    expect(bans()[1]).toMatchObject({ method: 'DELETE', path: `/guilds/${GUILD}/bans/${PLAYER_ONE.id}` });
  });

  it('uses verified links only, is opt-in, and never bans staff from Discord as a side effect', async () => {
    const owner = await enableBot({ syncBans: true });
    // An unverified claim on Anubis must not get anyone banned.
    const squatter = await playerSignIn(PLAYER_TWO);
    await link(squatter, 'Anubis');
    await ctx.services.moderation.ban(actor, ANUBIS, 'x');
    await new Promise((r) => setTimeout(r, 200));
    expect(bans()).toHaveLength(0);

    // A verified link on a panel user's character: the ban is not carried to Discord.
    ctx.services.siteAccounts.signIn({ id: ADMIN_D, username: 'admin', avatar: null });
    ctx.services.siteAccounts.linkPlayer(ctx.services.siteAccounts.getByDiscordId(ADMIN_D)!.id, ctx.services.players.find('CattivaFan')[0]!.id);
    ctx.services.siteAccounts.verify(ctx.services.siteAccounts.getByDiscordId(ADMIN_D)!.id, 'staff');
    await ctx.services.moderation.ban(actor, 'epic_0f3a9c2b1d', 'x');
    await vi.waitFor(() => expect(rest.calls.some((c) => c.path === `/channels/${EVENTS}/messages` && String(c.body?.content).includes('panel user'))).toBe(true), { timeout: 3000 });
    expect(bans()).toHaveLength(0);

    // Off by default: nothing happens without the setting.
    await put(owner, '/api/v1/discord-bot/settings', botSettings({ syncBans: false }));
    await verify(PLAYER_THREE, 'Lamball Enjoyer');
    rest.calls.length = 0;
    await ctx.services.moderation.ban(actor, LAMBALL, 'x');
    await new Promise((r) => setTimeout(r, 200));
    expect(bans()).toHaveLength(0);
  });

  it('bans and unbans a verified character when their Discord account is banned or unbanned, without looping', async () => {
    gateway = await startFakeGateway();
    ctx.services.discordBot.setApiBase(rest.url, gateway.url);
    await enableBot({ syncBans: true, gatewayEnabled: true });
    await vi.waitFor(() => expect(ctx.services.discordBot.gatewayStatus().state).toBe('connected'));
    await verify(PLAYER_ONE, 'Lamball Enjoyer');
    rest.calls.length = 0;

    gateway.dispatchAll('GUILD_BAN_ADD', { guild_id: GUILD, user: { id: PLAYER_ONE.id } });
    await vi.waitFor(() => expect(ctx.services.moderation.isBanned(LAMBALL)).toBe(true));
    expect(ctx.services.moderation.history(LAMBALL)[0]).toMatchObject({ action: 'ban', actorUsername: 'Discord ban sync' });
    await ctx.services.discordBot.idle();
    // The game ban came from Discord, so it is not sent back to Discord.
    expect(bans()).toHaveLength(0);
    expect(ctx.services.moderation.history(LAMBALL).filter((h) => h.action === 'ban')).toHaveLength(1);

    gateway.dispatchAll('GUILD_BAN_REMOVE', { guild_id: GUILD, user: { id: PLAYER_ONE.id } });
    await vi.waitFor(() => expect(ctx.services.moderation.isBanned(LAMBALL)).toBe(false));
    await ctx.services.discordBot.idle();
    expect(bans()).toHaveLength(0);

    // Ignored: another server, an unlinked user, and an unverified claim.
    gateway.dispatchAll('GUILD_BAN_ADD', { guild_id: '999999999999999999', user: { id: PLAYER_ONE.id } });
    gateway.dispatchAll('GUILD_BAN_ADD', { guild_id: GUILD, user: { id: '777777777777777777' } });
    const squatter = await playerSignIn(PLAYER_TWO);
    await link(squatter, 'Anubis');
    gateway.dispatchAll('GUILD_BAN_ADD', { guild_id: GUILD, user: { id: PLAYER_TWO.id } });
    await new Promise((r) => setTimeout(r, 300));
    expect(ctx.services.moderation.isBanned(LAMBALL)).toBe(false);
    expect(ctx.services.moderation.isBanned(ANUBIS)).toBe(false);
  });
});

describe('moderation commands with a Discord member', () => {
  const slash = async (name: string, caller: string, options: Array<Record<string, unknown>>, users: Record<string, { username: string }> = {}) => {
    const interaction = { id: 'i', type: 2, token: 't', application_id: APP, guild_id: GUILD, member: { user: { id: caller } }, data: { name, options, resolved: { users } } } as unknown as Interaction;
    ctx.services.discordBot.handleInteraction(interaction);
    await ctx.services.discordBot.idle();
    return String(rest.calls.filter((c) => c.method === 'PATCH' && c.path.endsWith('/messages/@original')).at(-1)?.body?.content);
  };
  const member = (id: string) => ({ name: 'member', type: 6, value: id });
  const discordBans = () => rest.calls.filter((c) => c.path.includes('/bans/'));
  const verify = (account: DiscordAccount, query: string) => {
    ctx.services.siteAccounts.signIn(account);
    const acc = ctx.services.siteAccounts.getByDiscordId(account.id)!;
    ctx.services.siteAccounts.linkPlayer(acc.id, ctx.services.players.find(query)[0]!.id);
    ctx.services.siteAccounts.verify(acc.id, 'staff');
  };

  it('/ban @member bans them on Discord and in game through their verified character', async () => {
    await enableBot();
    verify(PLAYER_ONE, 'Lamball Enjoyer');
    const text = await slash('ban', ADMIN_D, [member(PLAYER_ONE.id), { name: 'reason', type: 3, value: 'Cheating' }], { [PLAYER_ONE.id]: { username: 'lambfan' } });
    expect(text).toBe('Banned **lambfan** from Discord. Banned **Lamball Enjoyer** in game.');
    expect(ctx.services.moderation.isBanned(LAMBALL)).toBe(true);
    // Discord was asked once, not again by the ban-sync listener.
    await ctx.services.discordBot.idle();
    expect(discordBans()).toHaveLength(1);
    expect(discordBans()[0]).toMatchObject({ method: 'PUT', path: `/guilds/${GUILD}/bans/${PLAYER_ONE.id}` });
    expect(decodeURIComponent(discordBans()[0]!.reason!)).toContain('Cheating');
  });

  it('/ban @member for someone with no verified character bans them on Discord only', async () => {
    await enableBot();
    // A claim that was never verified counts for nothing.
    ctx.services.siteAccounts.signIn(PLAYER_TWO);
    ctx.services.siteAccounts.linkPlayer(ctx.services.siteAccounts.getByDiscordId(PLAYER_TWO.id)!.id, ctx.services.players.find('Anubis')[0]!.id);
    const text = await slash('ban', ADMIN_D, [member(PLAYER_TWO.id)], { [PLAYER_TWO.id]: { username: 'impostor' } });
    expect(text).toContain('Banned **impostor** from Discord.');
    expect(text).toContain('no verified character');
    expect(ctx.services.moderation.isBanned(ANUBIS)).toBe(false);
    expect(discordBans()).toHaveLength(1);
  });

  it('/unban @member and /kick @member use the verified character too', async () => {
    await enableBot();
    verify(PLAYER_ONE, 'Lamball Enjoyer');
    await ctx.services.moderation.ban({ userId: null, username: 't' }, LAMBALL, 'x');
    const unban = await slash('unban', ADMIN_D, [member(PLAYER_ONE.id)], { [PLAYER_ONE.id]: { username: 'lambfan' } });
    expect(unban).toBe('Unbanned **lambfan** on Discord. Unbanned **Lamball Enjoyer** in game.');
    expect(ctx.services.moderation.isBanned(LAMBALL)).toBe(false);
    expect(discordBans().at(-1)).toMatchObject({ method: 'DELETE' });

    ctx.services.players.markAllOffline();
    await ctx.services.players.refreshOnline();
    expect(await slash('kick', MOD_D, [member(PLAYER_ONE.id)], { [PLAYER_ONE.id]: { username: 'lambfan' } })).toBe('Kicked **Lamball Enjoyer**.');
    expect(await slash('kick', MOD_D, [member(PLAYER_TWO.id)], { [PLAYER_TWO.id]: { username: 'impostor' } })).toContain('no verified character');
    expect(await slash('kick', MOD_D, [])).toContain('Say which player');
  });

  it('will not Discord-ban yourself, the bot, or a panel user of equal or higher role', async () => {
    await enableBot();
    expect(await slash('ban', ADMIN_D, [member(ADMIN_D)])).toContain('yourself');
    expect(await slash('ban', ADMIN_D, [member(OWNER_D)])).toContain('same or a higher role');
    // A peer is also refused; a lower role is fine.
    ctx.services.users.update(ctx.services.users.findByDiscordId(MOD_D)!.id, { role: 'admin' });
    expect(await slash('ban', ADMIN_D, [member(MOD_D)])).toContain('same or a higher role');
    ctx.services.users.update(ctx.services.users.findByDiscordId(MOD_D)!.id, { role: 'moderator' });
    expect(await slash('ban', ADMIN_D, [member(MOD_D)], { [MOD_D]: { username: 'mod' } })).toContain('Banned **mod** from Discord');
    expect(await slash('ban', MOD_D, [member(PLAYER_ONE.id)])).toContain('isn’t allowed');
  });

  it('report Discord refusing, in plain words', async () => {
    await enableBot();
    rest.failing.set('/guilds/', 403);
    const text = await slash('ban', ADMIN_D, [member(PLAYER_TWO.id)], { [PLAYER_TWO.id]: { username: 'impostor' } });
    expect(text).toContain('lacks access');
  });
});
