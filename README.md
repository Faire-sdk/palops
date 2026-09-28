# PalOps

A simple, secure web panel for managing a Palworld dedicated server from the browser.

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

## Quick start (development)

Requires Node.js 20.12+.

```bash
npm install
npm run dev
```

- Web UI: http://localhost:5173 (proxies `/api` to the server)
- API: http://localhost:8080

On first start the server logs a **setup token**. Open the UI, enter the token and create the owner account.
Then go to **Settings → Server connection** and either point it at your Palworld server or pick
**Mock server** to explore the panel without one.

## Production

```bash
npm ci
npm run build
cd server
PANEL_SECRET=$(openssl rand -hex 32) NODE_ENV=production COOKIE_SECURE=true TRUST_PROXY=true npm start
```

Keep `PANEL_SECRET` stable (store it in your secrets manager or `.env`): it encrypts the saved Palworld admin password.
Put the panel behind a reverse proxy that terminates HTTPS. `GET /api/health` is a health check.
All variables are documented in [`.env.example`](.env.example).

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
    pages/
docs/
```

Routes never talk to Palworld directly; they call `PalworldService`, which picks an adapter
implementing `PalworldAdapter`. Supporting RCON or a server wrapper later means adding an adapter, not touching routes or UI.

## API

All endpoints are under `/api/v1` and use JSON. State-changing requests must send `X-PalOps-CSRF: 1`.

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/auth/setup` | public: is first-run setup pending? |
| POST | `/auth/setup` | public, requires setup token |
| POST | `/auth/login`, `/auth/logout` | public |
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
| GET | `/api/health` | public (unversioned) |

## Security notes

- Passwords are hashed with scrypt; login timing is equalised for unknown users.
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
| `npm run dev` | Server (watch mode) + Vite dev server |
| `npm run build` | Build frontend and server |
| `npm start` | Run the built server |
| `npm test` | Server test suite |
| `npm run typecheck` | Typecheck server and web |
