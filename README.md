# PalOps

A simple, secure web panel for managing a Palworld dedicated server from the browser, plus a public website for
the server where players sign in with Discord and see their character.

| Path | What |
| --- | --- |
| `/` | Public server website: status, how to join, who's online, player sign-in and profile |
| `/panel` | Staff panel (Discord sign-in, roles) |
| `/api/v1` | JSON API. `/api/v1/public/*` is open (CORS) for embedding status on an existing site |

> **Status:** early MVP. Foundation, authentication/roles and the server connection layer are in place.
> Player moderation, console, configuration editing, lifecycle controls and backups are next.
> See [docs/roadmap-status.md](docs/roadmap-status.md).

## Stack

| Part | Choice | Why |
| --- | --- | --- |
| Backend | Node.js + TypeScript + [Fastify](https://fastify.dev) | Small, fast, good plugin model |
| Database | SQLite via `better-sqlite3`, built-in migrations | Relational, zero-ops, one file to back up |
| Validation | [zod](https://zod.dev) | Every request body/query is parsed before use |
| Frontend | React + Vite + TypeScript, plain CSS | Component-based, no UI framework lock-in |
| Palworld | Official Palworld REST API adapter (+ mock adapter) | Isolated behind one service interface |

The whole panel runs as **one process**: the API serves the built frontend, so there is only one port to put behind a reverse proxy.

## Quick start (local)

Requires Node.js 20.12+.

```bash
npm run setup   # install + write server/.env with local defaults
npm run dev
```

- Website: http://localhost:5173, staff panel: http://localhost:5173/panel (setup token `local-setup-token`)
- Discord sign-in uses a local stand-in page, and a mock Palworld server is connected, so nothing external is needed.

See **[docs/local-setup.md](docs/local-setup.md)** for walkthroughs of each flow, using a real Discord app or game
server locally, tests, and running the production image with `docker compose`.

## Production

**Railway:** see [docs/deploy-railway.md](docs/deploy-railway.md). The repo includes a `Dockerfile` and `railway.json`.

**Docker anywhere:**

```bash
docker build -t palops .
docker run -d -p 8080:8080 -v palops-data:/data -e PANEL_SECRET=$(openssl rand -hex 32) -e TRUST_PROXY=true -e COOKIE_SECURE=true palops
```

**Plain Node:**

```bash
npm ci
npm run build
cd server
PANEL_SECRET=$(openssl rand -hex 32) NODE_ENV=production COOKIE_SECURE=true TRUST_PROXY=true npm start
```

Keep `PANEL_SECRET` stable (store it in your secrets manager or `.env`): it encrypts the saved Palworld admin password.
Put the panel behind a reverse proxy that terminates HTTPS. `GET /api/health` is a health check.
All variables are documented in [`.env.example`](.env.example).

## Signing in

**Discord OAuth2 is the main sign-in.** Username/password is optional.

1. Create an application at <https://discord.com/developers/applications>.
2. Under **OAuth2**, copy the Client ID and Client Secret and add a redirect:
   `https://<your panel>/api/v1/auth/discord/callback` (locally: `http://localhost:5173/api/v1/auth/discord/callback`).
3. Set `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` and `DISCORD_REDIRECT_URI`.

The panel only asks Discord for the `identify` scope (id, username, avatar). Signing in with Discord does not create
an account by itself: an owner adds people under **Settings → Users** by their Discord user ID and picks their role.
Someone who isn't added yet is shown their Discord ID after trying to sign in, so they can send it to an owner.
Existing password users can link Discord under **Settings → Account**.

Password sign-in is off by default once Discord is configured. Set `AUTH_PASSWORD_LOGIN=true` to keep it as a
second option (useful as a fallback if Discord is down).

Linking panel users to Discord ids is also the groundwork for a Discord bot: bot commands can map the Discord user
to a panel user and check the same role permissions. Discord code lives in `server/src/services/discord/`.

## Public website

The website at `/` is meant to be the server's main site. It shows server status, the join address, who's online
(name, level and guild) and the rules. Players sign in with Discord and link their character by in-game name or
platform ID to see their level, guild, first/last seen and online status.

- Player accounts are separate from staff accounts: signing in on the website never grants panel access, and any
  Discord user can create one.
- Character links are self-service and marked **unverified** for now. Staff verification, or an in-game code through
  a server plugin, can be added later.
- The panel records every player it sees online once a minute (`players` table), so profiles keep working when the
  player is offline. The official REST API doesn't report guilds; guild names show up once a connection method that
  provides them is added (the mock server includes them).
- Edit the rules and texts in `web/src/site/HomePage.tsx`. Configure the join address, Discord invite and player list
  with the `SITE_*` variables in `.env.example`.
- To show live status on a different website, fetch `GET /api/v1/public/server` and `GET /api/v1/public/players`.

## Connecting to Palworld

The panel talks to the server through the official REST API:

1. In `PalWorldSettings.ini` set `RESTAPIEnabled=True` and an `AdminPassword`.
2. Note `RESTAPIPort` (default `8212`) and restart the Palworld server.
3. In the panel, open **Settings → Server connection**, enter host, port and the admin password, and click **Test connection**.

**Do not expose the REST API port to the internet.** Allow it only from the panel's host.

## Roles

| Permission | Owner | Admin | Moderator | Viewer |
| --- | :-: | :-: | :-: | :-: |
| View dashboard, server info, online players | ✓ | ✓ | ✓ | ✓ |
| Kick players, add moderation notes | ✓ | ✓ | ✓ | |
| Ban/unban, console, broadcast, server control, config, logs, backups | ✓ | ✓ | | |
| Server connection settings, manage panel users | ✓ | | | |

Permissions are defined in [`server/src/services/authentication/permissions.ts`](server/src/services/authentication/permissions.ts)
and enforced on every API route; the UI only hides what you can't use.

## Project layout

```text
server/
  src/
    api/v1/            HTTP routes (versioned)
    services/
      palworld/        Palworld integration: adapter interface, REST API adapter, mock adapter
      servers/         Stored server connections (credentials encrypted at rest)
      authentication/  Users, sessions, passwords, roles & permissions, password resets
      discord/         Discord OAuth2 (and later the Discord bot)
      players/         Players seen on the server (first/last seen, level, guild)
      site/            Public-website player accounts and sessions
      audit/           Append-only audit log
    database/          SQLite connection and migrations
    middleware/        Authentication, permission checks, CSRF and security headers
    utils/
  test/                Vitest API and service tests
web/
  src/
    api/               Typed API client
    auth/              Session context
    components/        Layout, cards, tables, modals, toasts, form fields
    panel/             Staff panel app (served at /panel)
    site/              Public website app (served at /)
    pages/             Panel pages
docs/
```

Routes never talk to Palworld directly; they call `PalworldService`, which picks an adapter
implementing `PalworldAdapter`. Supporting RCON or a server wrapper later means adding an adapter, not touching routes or UI.

## API

All endpoints are under `/api/v1` and use JSON. State-changing requests must send `X-PalOps-CSRF: 1`.

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/auth/options` | public: setup pending? which sign-in methods are on |
| POST | `/auth/discord/authorize` | public (`intent`: login, setup with token, or link when signed in) |
| GET | `/auth/discord/callback` | Discord redirect target |
| POST | `/auth/discord/unlink` | signed in, only if a password remains usable |
| POST | `/auth/setup` | public, requires setup token (password sign-in) |
| POST | `/auth/login` | public (password sign-in) |
| POST | `/auth/logout` | signed in |
| GET | `/auth/me` | signed in |
| POST | `/auth/password` | signed in (requires current password) |
| POST | `/auth/reset` | public, requires one-time reset token |
| GET/POST | `/users` | `users.manage` |
| PATCH | `/users/:id` | `users.manage` |
| POST | `/users/:id/password-reset` | `users.manage` |
| GET | `/server/status` | `server.view` |
| POST | `/server/announce` | `server.broadcast` |
| GET/PUT | `/server/connection` | `server.connection` |
| POST | `/server/connection/test` | `server.connection` |
| GET | `/players` | `players.view` (online players) |
| GET | `/logs/audit` | `audit.view` |
| GET | `/public/server`, `/public/players` | public, CORS open, no IPs or platform IDs |
| GET | `/site/me` | player signed in on the website |
| POST | `/site/link`, `/site/unlink`, `/site/logout` | player signed in on the website |
| GET | `/api/health` | public (unversioned) |

## Security notes

- Discord OAuth2 uses a single-use, server-side `state` bound to the browser by a cookie; only the `identify` scope is requested and Discord tokens are not stored.
- Passwords (when enabled) are hashed with scrypt; login timing is equalised for unknown users.
- Sessions are random tokens in `HttpOnly`, `SameSite=Strict` cookies; only a SHA-256 of the token is stored.
  Sessions expire after inactivity and at an absolute maximum; changing a password signs out other sessions.
- CSRF: `SameSite=Strict` plus a required custom header and an `Origin` check on state-changing requests.
- Login, setup and reset endpoints are rate limited.
- The Palworld admin password is encrypted with AES-256-GCM (key derived from `PANEL_SECRET`) and never returned by the API or written to logs.
- The panel never runs shell commands from user input.
- Security headers (CSP, `X-Frame-Options: DENY`, `nosniff`) are set on every response.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run setup` | Install dependencies and write `server/.env` for local development |
| `npm run reset:local` | Delete the local database to start from first-run setup |
| `npm run dev` | Server (watch mode) + Vite dev server |
| `npm run build` | Build frontend and server |
| `npm start` | Run the built server |
| `npm test` | Server test suite |
| `npm run typecheck` | Typecheck server and web |
