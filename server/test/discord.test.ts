import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/database/db.js';
import { migrations } from '../src/database/migrations.js';
import type { DiscordAccount } from '../src/services/authentication/users.js';
import { DiscordOAuthClient } from '../src/services/discord/oauth.js';
import { api, createTestApp, loginAs, PASSWORD, sessionCookie } from './helpers.js';

const DISCORD_ENV = {
  DISCORD_CLIENT_ID: '123456789012345678',
  DISCORD_CLIENT_SECRET: 'shh',
  DISCORD_REDIRECT_URI: 'https://panel.example/api/v1/auth/discord/callback',
};

const ALICE: DiscordAccount = { id: '111111111111111111', username: 'alice', avatar: 'abc' };

let ctx: Awaited<ReturnType<typeof createTestApp>>;
/** The Discord account the stubbed OAuth exchange will "sign in" as. */
let nextAccount: DiscordAccount;

async function setup(env: Record<string, string> = {}) {
  ctx = await createTestApp({ ...DISCORD_ENV, ...env });
  nextAccount = ALICE;
  ctx.services.discordOAuth = {
    authorizeUrl: (state) => `https://discord.com/oauth2/authorize?state=${state}`,
    exchange: async (code) => {
      if (code !== 'good-code') throw new Error('bad code');
      return nextAccount;
    },
  };
}

/** Runs authorize + callback like a browser would; returns the callback response. */
async function discordFlow(app: FastifyInstance, body: Record<string, unknown>, opts: { cookie?: string; code?: string } = {}) {
  const start = await api(app, { method: 'POST', url: '/api/v1/auth/discord/authorize', payload: body, cookie: opts.cookie });
  expect(start.statusCode, start.body).toBe(200);
  const state = new URL(start.json().url).searchParams.get('state')!;
  const stateCookie = start.cookies.find((c) => c.name === 'palops_oauth_state')!;
  expect(stateCookie.sameSite).toBe('Lax');
  expect(stateCookie.httpOnly).toBe(true);
  return app.inject({
    method: 'GET',
    url: `/api/v1/auth/discord/callback?code=${opts.code ?? 'good-code'}&state=${state}`,
    headers: { cookie: `palops_oauth_state=${stateCookie.value}` },
  });
}

describe('sign-in options', () => {
  it('makes Discord primary and turns passwords off by default once Discord is configured', async () => {
    await setup();
    const res = await api(ctx.app, { method: 'GET', url: '/api/v1/auth/options' });
    expect(res.json().providers).toEqual({ discord: true, password: false, emergency: false });
    const login = await api(ctx.app, { method: 'POST', url: '/api/v1/auth/login', payload: { username: 'x', password: 'y' } });
    expect(login.statusCode).toBe(403);
  });

  it('keeps password login when explicitly enabled', async () => {
    await setup({ AUTH_PASSWORD_LOGIN: 'true' });
    expect((await api(ctx.app, { method: 'GET', url: '/api/v1/auth/options' })).json().providers).toEqual({
      discord: true,
      password: true,
      emergency: false,
    });
    await loginAs(ctx.app, ctx.services, 'viewer');
  });
});

describe('Discord OAuth2 flow', () => {
  beforeEach(() => setup());

  it('creates the owner from Discord during first-run setup', async () => {
    const bad = await api(ctx.app, {
      method: 'POST',
      url: '/api/v1/auth/discord/authorize',
      payload: { intent: 'setup', setupToken: 'wrong' },
    });
    expect(bad.statusCode).toBe(403);

    const res = await discordFlow(ctx.app, { intent: 'setup', setupToken: 'test-setup-token-123' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/panel');
    const me = await api(ctx.app, { method: 'GET', url: '/api/v1/auth/me', cookie: sessionCookie(res) });
    expect(me.json().user).toMatchObject({ username: 'alice', role: 'owner', hasPassword: false, discord: { id: ALICE.id } });
    expect(ctx.services.setup.required).toBe(false);
  });

  it('signs in a user whose Discord account was added by an owner', async () => {
    await ctx.services.users.create({ username: 'alice_panel', role: 'moderator', discord: { id: ALICE.id, username: null, avatar: null } });
    const res = await discordFlow(ctx.app, { intent: 'login' });
    expect(res.headers.location).toBe('/panel');
    const me = await api(ctx.app, { method: 'GET', url: '/api/v1/auth/me', cookie: sessionCookie(res) });
    // Name and avatar are refreshed from Discord on sign-in.
    expect(me.json().user).toMatchObject({ username: 'alice_panel', role: 'moderator', discord: { username: 'alice', avatar: 'abc' } });
  });

  it('refuses unknown Discord accounts and tells them their id', async () => {
    const res = await discordFlow(ctx.app, { intent: 'login' });
    expect(res.headers.location).toBe(`/panel?auth_error=not_authorized&discord_id=${ALICE.id}`);
    expect(res.cookies.find((c) => c.name === 'palops_session')).toBeUndefined();
    expect(ctx.services.audit.list({ limit: 1, offset: 0 }).entries[0]).toMatchObject({ action: 'login_failed' });
  });

  it('refuses disabled users', async () => {
    const user = await ctx.services.users.create({ username: 'alice_panel', role: 'owner', discord: ALICE });
    await ctx.services.users.create({ username: 'other_owner', role: 'owner', discord: { ...ALICE, id: '222222222222222222' } });
    ctx.services.users.update(user.id, { disabled: true });
    const res = await discordFlow(ctx.app, { intent: 'login' });
    expect(res.headers.location).toBe('/panel?auth_error=not_authorized');
  });

  it('rejects a callback without the matching state cookie, and state is single-use', async () => {
    await ctx.services.users.create({ username: 'alice_panel', role: 'viewer', discord: ALICE });
    const start = await api(ctx.app, { method: 'POST', url: '/api/v1/auth/discord/authorize', payload: { intent: 'login' } });
    const state = new URL(start.json().url).searchParams.get('state')!;

    const noCookie = await ctx.app.inject({ method: 'GET', url: `/api/v1/auth/discord/callback?code=good-code&state=${state}` });
    expect(noCookie.headers.location).toBe('/panel?auth_error=invalid_state');

    const forged = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/auth/discord/callback?code=good-code&state=a.forged',
      headers: { cookie: 'palops_oauth_state=a.forged' },
    });
    expect(forged.headers.location).toBe('/panel?auth_error=invalid_state');

    const again = await api(ctx.app, { method: 'POST', url: '/api/v1/auth/discord/authorize', payload: { intent: 'login' } });
    const goodState = new URL(again.json().url).searchParams.get('state')!;
    const callback = () =>
      ctx.app.inject({
        method: 'GET',
        url: `/api/v1/auth/discord/callback?code=good-code&state=${goodState}`,
        headers: { cookie: `palops_oauth_state=${goodState}` },
      });
    expect((await callback()).headers.location).toBe('/panel');
    const replay = await callback();
    expect(replay.headers.location).toBe('/panel?auth_error=invalid_state');
  });

  it('handles the user cancelling on Discord and failed exchanges', async () => {
    const start = await api(ctx.app, { method: 'POST', url: '/api/v1/auth/discord/authorize', payload: { intent: 'login' } });
    const state = new URL(start.json().url).searchParams.get('state')!;
    const cancelled = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/auth/discord/callback?error=access_denied&state=${state}`,
      headers: { cookie: `palops_oauth_state=${state}` },
    });
    expect(cancelled.headers.location).toBe('/panel?auth_error=cancelled');
    const badCode = await discordFlow(ctx.app, { intent: 'login' }, { code: 'bad' });
    expect(badCode.headers.location).toBe('/panel?auth_error=discord_error');
  });
});

describe('linking Discord to an existing account', () => {
  beforeEach(() => setup({ AUTH_PASSWORD_LOGIN: 'true' }));

  it('links, then allows unlinking only while a password remains usable', async () => {
    const cookie = await loginAs(ctx.app, ctx.services, 'admin', 'pat');
    expect((await api(ctx.app, { method: 'POST', url: '/api/v1/auth/discord/authorize', payload: { intent: 'link' } })).statusCode).toBe(401);

    const res = await discordFlow(ctx.app, { intent: 'link' }, { cookie });
    expect(res.headers.location).toBe('/panel/settings?tab=account&discord=linked');
    expect(ctx.services.users.findForLogin('pat')!.discord?.id).toBe(ALICE.id);

    const unlink = await api(ctx.app, { method: 'POST', url: '/api/v1/auth/discord/unlink', cookie });
    expect(unlink.statusCode).toBe(200);
    expect(unlink.json().user.discord).toBeNull();
  });

  it('refuses a Discord account already linked to someone else', async () => {
    await ctx.services.users.create({ username: 'alice_panel', role: 'viewer', discord: ALICE });
    const cookie = await loginAs(ctx.app, ctx.services, 'admin', 'pat');
    const res = await discordFlow(ctx.app, { intent: 'link' }, { cookie });
    expect(res.headers.location).toBe('/panel/settings?tab=account&auth_error=discord_in_use');
  });

  it('refuses to unlink a Discord-only user', async () => {
    const user = await ctx.services.users.create({ username: 'alice_panel', role: 'viewer', discord: ALICE });
    const { token } = ctx.services.sessions.create(user.id);
    const res = await api(ctx.app, { method: 'POST', url: '/api/v1/auth/discord/unlink', cookie: `palops_session=${token}` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('last_sign_in_method');
  });
});

describe('managing users by Discord ID', () => {
  beforeEach(() => setup());

  it('lets an owner add a Discord user and rejects password users when passwords are off', async () => {
    const owner = await ctx.services.users.create({ username: 'boss', role: 'owner', discord: { ...ALICE, id: '999999999999999999' } });
    const { token } = ctx.services.sessions.create(owner.id);
    const cookie = `palops_session=${token}`;

    const ok = await api(ctx.app, { method: 'POST', url: '/api/v1/users', cookie, payload: { username: 'newmod', role: 'moderator', discordId: ALICE.id } });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().user).toMatchObject({ hasPassword: false, discord: { id: ALICE.id } });

    const withPassword = await api(ctx.app, { method: 'POST', url: '/api/v1/users', cookie, payload: { username: 'pw', role: 'viewer', password: PASSWORD } });
    expect(withPassword.statusCode).toBe(400);
    const nothing = await api(ctx.app, { method: 'POST', url: '/api/v1/users', cookie, payload: { username: 'nada', role: 'viewer' } });
    expect(nothing.statusCode).toBe(400);
    const badId = await api(ctx.app, { method: 'POST', url: '/api/v1/users', cookie, payload: { username: 'bad', role: 'viewer', discordId: '12ab' } });
    expect(badId.statusCode).toBe(400);
    const duplicate = await api(ctx.app, { method: 'POST', url: '/api/v1/users', cookie, payload: { username: 'dupe', role: 'viewer', discordId: ALICE.id } });
    expect(duplicate.statusCode).toBe(409);

    const unlink = await api(ctx.app, { method: 'PATCH', url: `/api/v1/users/${ok.json().user.id}`, cookie, payload: { discordId: null } });
    expect(unlink.statusCode).toBe(400);
  });
});

describe('DiscordOAuthClient', () => {
  let fake: Server;
  let base: string;
  beforeAll(async () => {
    fake = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const json = (status: number, data: unknown) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
        if (req.url === '/oauth2/token' && req.method === 'POST') {
          const params = new URLSearchParams(body);
          const auth = `Basic ${Buffer.from('123456789012345678:shh').toString('base64')}`;
          if (req.headers.authorization !== auth || params.get('code') !== 'abc' || params.get('grant_type') !== 'authorization_code') {
            return json(400, { error: 'invalid_grant' });
          }
          return json(200, { access_token: 'tok', token_type: 'Bearer' });
        }
        if (req.headers.authorization === 'Bearer tok') {
          if (req.url === '/users/@me') return json(200, { id: ALICE.id, username: 'alice', global_name: 'Alice', avatar: 'abc', email: 'alice@example.com', verified: true });
          if (req.url === '/users/@me/connections') return json(200, [{ type: 'steam', id: '76561198000000001', name: 'alice_steam', verified: true, visibility: 1 }, { nonsense: true }]);
          if (req.url === '/users/@me/guilds?with_counts=true')
            return json(200, [
              { id: '555', name: 'Palworld Friends', icon: 'ic', owner: false, permissions: '8', approximate_member_count: 120, approximate_presence_count: 30 },
              { id: '556', name: 'Mine', icon: null, owner: true, permissions: 'junk' },
            ]);
          if (req.url === '/users/@me/guilds/555/member') return json(200, { joined_at: '2026-09-01T00:00:00Z', nick: 'Ali', roles: ['77'] });
          if (req.url === '/users/@me/guilds/666/member') return json(404, { message: 'Unknown Guild' });
          if (req.url === '/users/@me/guilds/777/member') return json(500, {});
        }
        json(401, {});
      });
    });
    await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => fake.close(() => r())));

  const client = () =>
    new DiscordOAuthClient({ clientId: '123456789012345678', clientSecret: 'shh', redirectUri: DISCORD_ENV.DISCORD_REDIRECT_URI, apiBase: base });

  it('asks for every scope sign-in uses', () => {
    const url = new URL(client().authorizeUrl('st'));
    expect(url.origin).toBe('https://discord.com');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      scope: 'identify email connections guilds guilds.join guilds.members.read',
      state: 'st',
      response_type: 'code',
    });
  });

  it('exchanges a code for the Discord user and their profile', async () => {
    // The access token is handed back for the moment of sign-in (e.g. to join the server) and never stored.
    const signIn = await client().exchange('abc', { guildId: '555' });
    expect(signIn).toEqual({
      ...ALICE,
      accessToken: expect.any(String),
      profile: {
        globalName: 'Alice',
        banner: null,
        accentColor: null,
        email: 'alice@example.com',
        emailVerified: true,
        connections: [{ type: 'steam', id: '76561198000000001', name: 'alice_steam', verified: true }],
        guilds: [
          { id: '555', name: 'Palworld Friends', icon: 'ic', owner: false, admin: true, memberCount: 120, onlineCount: 30 },
          { id: '556', name: 'Mine', icon: null, owner: true, admin: true, memberCount: null, onlineCount: null },
        ],
        communityMember: { joinedAt: '2026-09-01T00:00:00Z', nick: 'Ali', roles: ['77'] },
      },
    });
    // Not in the server, membership couldn't be checked, and no server set.
    expect((await client().exchange('abc', { guildId: '666' })).profile!.communityMember).toBe(false);
    expect((await client().exchange('abc', { guildId: '777' })).profile!.communityMember).toBeNull();
    expect((await client().exchange('abc')).profile!.communityMember).toBeNull();
    await expect(client().exchange('wrong')).rejects.toThrow('HTTP 400');
  });
});

describe('migration to Discord accounts', () => {
  it('keeps existing users and their sessions', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT 'x')`);
    db.exec(migrations[0]!.sql);
    db.prepare(`INSERT INTO schema_migrations (id, name) VALUES (1, 'initial')`).run();
    db.prepare(`INSERT INTO users (username, password_hash, role) VALUES ('old', 'scrypt$x', 'owner')`).run();
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at) VALUES ('s1', 1, '2999-01-01')`).run();

    migrate(db);

    expect(db.prepare('SELECT username, password_hash, discord_id FROM users').get()).toEqual({
      username: 'old',
      password_hash: 'scrypt$x',
      discord_id: null,
    });
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 1 });
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    // Cascades still point at the rebuilt users table.
    db.prepare('DELETE FROM users').run();
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 });
  });
});
