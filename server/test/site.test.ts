import { beforeEach, describe, expect, it } from 'vitest';
import type { DiscordAccount } from '../src/services/authentication/users.js';
import { api, createTestApp, loginAs } from './helpers.js';

const DISCORD_ENV = {
  DISCORD_CLIENT_ID: '123456789012345678',
  DISCORD_CLIENT_SECRET: 'shh',
  DISCORD_REDIRECT_URI: 'https://panel.example/api/v1/auth/discord/callback',
  AUTH_PASSWORD_LOGIN: 'true',
  SITE_JOIN_ADDRESS: 'play.example.com:8211',
};
const PLAYER_ONE: DiscordAccount = { id: '333333333333333333', username: 'lambfan', avatar: null };
const PLAYER_TWO: DiscordAccount = { id: '444444444444444444', username: 'impostor', avatar: null };

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let nextAccount: DiscordAccount;

async function setup(env: Record<string, string> = {}) {
  ctx = await createTestApp({ ...DISCORD_ENV, ...env });
  ctx.services.discordOAuth = {
    authorizeUrl: (state) => `https://discord.com/oauth2/authorize?state=${state}`,
    exchange: async () => nextAccount,
  };
  // A mock server with three online players.
  ctx.services.servers.savePrimary({ name: 'Dev', adapter: 'mock', host: '', port: 8212, username: 'admin' });
}

async function playerSignIn(account: DiscordAccount) {
  nextAccount = account;
  const start = await api(ctx.app, { method: 'POST', url: '/api/v1/auth/discord/authorize', payload: { intent: 'player' } });
  const state = new URL(start.json().url).searchParams.get('state')!;
  const res = await ctx.app.inject({
    method: 'GET',
    url: `/api/v1/auth/discord/callback?code=c&state=${state}`,
    headers: { cookie: `palops_oauth_state=${state}` },
  });
  expect(res.headers.location).toBe('/account');
  const cookie = res.cookies.find((c) => c.name === 'palops_player');
  expect(cookie?.httpOnly).toBe(true);
  return `palops_player=${cookie!.value}`;
}

describe('public server info', () => {
  beforeEach(() => setup());

  it('shows status and the join address without leaking the REST API address', async () => {
    const res = await api(ctx.app, { method: 'GET', url: '/api/v1/public/server' });
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.json()).toMatchObject({ state: 'online', name: 'Mock Palworld Server', joinAddress: 'play.example.com:8211', players: { max: 32 } });
    expect(res.body).not.toContain('8212');
  });

  it('lists online players with only public fields and records them', async () => {
    const res = await api(ctx.app, { method: 'GET', url: '/api/v1/public/players' });
    const players = res.json().players;
    expect(players).toHaveLength(3);
    expect(Object.keys(players[0]).sort()).toEqual(['guild', 'id', 'level', 'name']);
    expect(res.body).not.toMatch(/steam_|127\.0\.0\.1/);
    expect(ctx.services.players.count()).toBe(3);
  });

  it('hides the player list when the owner turns it off', async () => {
    await setup({ SITE_SHOW_ONLINE_PLAYERS: 'false' });
    expect((await api(ctx.app, { method: 'GET', url: '/api/v1/public/players' })).statusCode).toBe(403);
  });
});

describe('player accounts', () => {
  beforeEach(() => setup());

  it('lets any Discord user sign in as a player, without panel access', async () => {
    const cookie = await playerSignIn(PLAYER_ONE);
    const me = await api(ctx.app, { method: 'GET', url: '/api/v1/site/me', cookie });
    expect(me.json()).toMatchObject({ account: { discord: { id: PLAYER_ONE.id } }, character: null });
    expect(ctx.services.users.count()).toBe(0);
    expect((await api(ctx.app, { method: 'GET', url: '/api/v1/auth/me', cookie })).statusCode).toBe(401);
    expect((await api(ctx.app, { method: 'GET', url: '/api/v1/server/status', cookie })).statusCode).toBe(401);
  });

  it('does not accept a panel session as a player session', async () => {
    const panel = await loginAs(ctx.app, ctx.services, 'owner');
    expect((await api(ctx.app, { method: 'GET', url: '/api/v1/site/me', cookie: panel })).statusCode).toBe(401);
  });

  it('links a character by name and shows its level, guild and online status', async () => {
    const cookie = await playerSignIn(PLAYER_ONE);
    const unknown = await api(ctx.app, { method: 'POST', url: '/api/v1/site/link', cookie, payload: { query: 'Nobody' } });
    expect(unknown.statusCode).toBe(404);

    const res = await api(ctx.app, { method: 'POST', url: '/api/v1/site/link', cookie, payload: { query: 'lamball enjoyer' } });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().character).toMatchObject({
      name: 'Lamball Enjoyer',
      level: 32,
      guild: 'Wool Gatherers',
      online: true,
      verified: false,
      platformId: 'steam_76561190000000001',
    });

    // Once verified, the character is locked to that account.
    const owner = ctx.services.siteAccounts.getByDiscordId(PLAYER_ONE.id)!;
    ctx.services.siteAccounts.verify(owner.id, 'staff');
    const other = await playerSignIn(PLAYER_TWO);
    const taken = await api(ctx.app, { method: 'POST', url: '/api/v1/site/link', cookie: other, payload: { query: 'steam_76561190000000001' } });
    expect(taken.statusCode).toBe(409);

    const unlink = await api(ctx.app, { method: 'POST', url: '/api/v1/site/unlink', cookie });
    expect(unlink.json().character).toBeNull();
  });

  it('lets a claim be taken over until it is verified, so nobody can squat on someone else’s character', async () => {
    const squatter = await playerSignIn(PLAYER_TWO);
    await api(ctx.app, { method: 'POST', url: '/api/v1/site/link', cookie: squatter, payload: { query: 'Lamball Enjoyer' } });
    const real = await playerSignIn(PLAYER_ONE);
    const claimed = await api(ctx.app, { method: 'POST', url: '/api/v1/site/link', cookie: real, payload: { query: 'Lamball Enjoyer' } });
    expect(claimed.statusCode).toBe(200);
    expect(claimed.json().character.name).toBe('Lamball Enjoyer');
    expect((await api(ctx.app, { method: 'GET', url: '/api/v1/site/me', cookie: squatter })).json().character).toBeNull();
  });

  it('keeps showing a linked character after they log off', async () => {
    const cookie = await playerSignIn(PLAYER_ONE);
    await api(ctx.app, { method: 'POST', url: '/api/v1/site/link', cookie, payload: { query: 'Anubis' } });
    await ctx.services.palworld.mock.kick('steam_76561190000000002');
    ctx.services.players.markAllOffline();
    await ctx.services.players.refreshOnline();
    const me = await api(ctx.app, { method: 'GET', url: '/api/v1/site/me', cookie });
    expect(me.json().character).toMatchObject({ name: 'Anubis', level: 47, online: false });
  });

  it('signs out', async () => {
    const cookie = await playerSignIn(PLAYER_ONE);
    await api(ctx.app, { method: 'POST', url: '/api/v1/site/logout', cookie });
    expect((await api(ctx.app, { method: 'GET', url: '/api/v1/site/me', cookie })).statusCode).toBe(401);
  });
});
