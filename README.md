# PalOps

A simple, secure web panel for managing a Palworld dedicated server from the browser, plus a public website for
the server where players sign in with Discord and see their character.

| Path | What |
| --- | --- |
| `/` | Public server website: status, how to join, who's online, player sign-in and profile |
| `/panel` | Staff panel (Discord sign-in, roles) |
| `/api/v1` | JSON API. `/api/v1/public/*` is open (CORS) for embedding status on an existing site |

> **Status:** early MVP. Foundation, authentication/roles and the server connection layer are in place.
> A view-only console, configuration editing, lifecycle controls and backups are next.
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

**Run PalOps on the same machine as your Palworld server.** It's the best choice for all the features:
the REST API stays on `127.0.0.1`, and planned features such as start/restart, logs, backups and guilds need the game machine.
[docs/deployment.md](docs/deployment.md) compares the options.

**Same machine (recommended):** see [docs/deploy-same-host.md](docs/deploy-same-host.md), which uses [`deploy/same-host/`](deploy/same-host) (Docker Compose with Caddy for HTTPS).

**Railway:** see [docs/deploy-railway.md](docs/deploy-railway.md), for when you can't run anything next to the game server. The repo includes a `Dockerfile` and `railway.json`.

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

PalOps talks to your server through Palworld's official REST API, which is built into current versions of the dedicated server.
It's plain HTTP, and it authenticates with Basic auth as user `admin` with the server's `AdminPassword`.

### 1. Turn on the REST API

Palworld reads its settings from `PalWorldSettings.ini`, which is created the first time the server runs.
If it's empty, copy the contents of `DefaultPalWorldSettings.ini` (in the server's install folder) into it.
Then, inside the `OptionSettings=(...)` line, set these three values and leave the rest as they are:

```ini
AdminPassword="<a long random password>",RESTAPIEnabled=True,RESTAPIPort=8212
```

Always stop the server before editing: Palworld reads the file on start and can overwrite changes made while it runs.

#### Linux (SteamCMD)

```bash
# Install or update the dedicated server (app 2394010)
steamcmd +force_install_dir ~/palworld +login anonymous +app_update 2394010 validate +quit

# Start it once so the config folder is created, then stop it (Ctrl+C or your systemd unit)
cd ~/palworld && ./PalServer.sh

# Edit the settings
cp -n ~/palworld/DefaultPalWorldSettings.ini ~/palworld/Pal/Saved/Config/LinuxServer/PalWorldSettings.ini
nano ~/palworld/Pal/Saved/Config/LinuxServer/PalWorldSettings.ini

# Start it again
./PalServer.sh      # or: sudo systemctl restart palworld
```

Adjust `~/palworld` if you installed elsewhere; without `+force_install_dir`, SteamCMD uses `~/Steam/steamapps/common/PalServer`.
If the `.ini` already has content, skip the `cp` line. Keep the REST API closed to the outside:

```bash
sudo ufw allow 8211/udp   # game port
sudo ufw deny 8212        # REST API: local only
```

#### Windows (Palworld Dedicated Server)

Install **Palworld Dedicated Server** from the Steam client (Library → Tools), or with SteamCMD:

```powershell
steamcmd +force_install_dir C:\palworld +login anonymous +app_update 2394010 validate +quit
```

Run `PalServer.exe` once so the config folder is created, then close it. Edit:

```text
<install folder>\Pal\Saved\Config\WindowsServer\PalWorldSettings.ini
```

The Steam client installs to `C:\Program Files (x86)\Steam\steamapps\common\PalServer` by default.
If the `.ini` is empty, paste in the contents of `DefaultPalWorldSettings.ini` from the install folder first. Start `PalServer.exe` again.

When Windows asks whether to allow `PalServer.exe` through the firewall, the allow rule covers every port it opens, including the REST API.
Add an explicit block for the REST API (block rules win over allow rules) from an administrator PowerShell:

```powershell
New-NetFirewallRule -DisplayName "Palworld game (UDP 8211)" -Direction Inbound -Protocol UDP -LocalPort 8211 -Action Allow
New-NetFirewallRule -DisplayName "Palworld REST API (block)" -Direction Inbound -Protocol TCP -LocalPort 8212 -Action Block
```

The block only affects other machines; PalOps on the same PC still reaches `127.0.0.1:8212`.
To run PalOps on that Windows machine, see [the Windows section of the same-host guide](docs/deploy-same-host.md#windows-server).

### 2. Check it answers

From the machine PalOps runs on:

```bash
curl -u admin:<AdminPassword> http://127.0.0.1:8212/v1/api/info
```

On Windows use `curl.exe` in PowerShell (plain `curl` is an alias there). You should get JSON with the server name and version.
Replace `127.0.0.1` with the game server's address if PalOps runs elsewhere.
A `401` means the password is wrong; no answer means the API is off, the port is different, or a firewall is in the way.

### 3. Add the connection in the panel

Sign in as the owner or an admin, open **Settings → Server connection** and fill in:

| Field | Value |
| --- | --- |
| Connection type | **Palworld REST API** |
| Host | `127.0.0.1` when PalOps runs on the game machine (recommended), otherwise the server's IP or hostname. No `http://` and no port. |
| REST API port | `RESTAPIPort`, `8212` by default |
| Username | `admin` |
| Admin password | The `AdminPassword` from step 1 |

Click **Test connection**, then **Save**. The header badge turns green and the dashboard, players page and public website start showing live data.
The password is stored encrypted with `PANEL_SECRET`; if you change that secret, enter the password again.

### 4. Turn on world data (optional)

Guilds, bases, the live map, pals, cheat signals and lag hotspots come from the REST API's world snapshot
(`GET /v1/api/game-data`). The server only offers it when started with the `-enable-gamedata-api` launch flag:

- **Linux:** `./PalServer.sh -enable-gamedata-api`. With systemd, add the flag to the `ExecStart=` line, then run
  `sudo systemctl daemon-reload && sudo systemctl restart palworld`.
- **Windows:** add `-enable-gamedata-api` to the `PalServer.exe` launch arguments: in the Steam client under
  Properties → Launch options, or at the end of the shortcut's Target, or in your start script.

PalOps reads a snapshot every 20 seconds (`WORLD_POLL_SECONDS`, `0` turns it off). Without the flag everything else
keeps working, and the **World** page explains how to switch it on.

**Map image.** PalOps doesn't ship the game's map art, so the live map starts as a coordinate grid. An owner or admin can
add a picture of the Palworld map (a screenshot of the in-game map works) with **World → Map → Add map image**, then
line it up by clicking two spots on it and giving their in-game coordinates, or picking a base or player PalOps knows.
The image is stored next to the database and only staff who can see the map can load it.

Positions and IP addresses from the snapshot are staff-only. The public website shows guild names with member and base
counts, and only when `SITE_SHOW_ONLINE_PLAYERS` is on.

### What PalOps uses the API for

| Endpoint | Used for |
| --- | --- |
| `GET /v1/api/info` | Server name, version and description |
| `GET /v1/api/metrics` | Online status, player count, FPS, uptime, in-game day |
| `GET /v1/api/players` | Online players (name, level, location, ping); also recorded once a minute for player history |
| `POST /v1/api/announce` | Broadcasts from the dashboard |
| `POST /v1/api/kick`, `/ban`, `/unban` | Moderation on the **Players** page, with the reason shown to the player and kept in their history |
| `POST /v1/api/save`, `/shutdown`, `/stop` | **Server** page: save now, shutdown with a countdown and message, force stop |
| `GET /v1/api/settings` | **Configuration** page (read-only view of the running settings) |
| `GET /v1/api/game-data` | **World** page and profiles: guilds, bases and their worker pals, each player's pals, the live map, cheat signals and lag hotspots (needs `-enable-gamedata-api`) |

The REST API can't start a stopped server, change settings, list bans made elsewhere, or give console or log access; those need PalOps on the game machine
(see [docs/deployment.md](docs/deployment.md)).

### Optional: Discord bot

Slash commands and channel notifications for staff, using each person's panel role. Off by default and PalOps doesn't need it. See [docs/discord-bot.md](docs/discord-bot.md).

### Optional: PalDefender

If your Windows server runs the [PalDefender](https://ultimeit.github.io/PalDefender/) plugin, PalOps can mirror bans (including IP bans) to it, show its ban list,
player inventories, pals, guilds and bases, and let admins give items and pals, teach technologies, summon, delete bases and send messages. It's off by default and PalOps doesn't need it. See [docs/paldefender.md](docs/paldefender.md).

### Keep the API private

**Never expose the REST API port to the internet.** Anyone who reaches it with the admin password can kick, ban or shut down the server, and it has no TLS.

- **Same machine (recommended):** use host `127.0.0.1` and block `8212` in the firewall. See [docs/deploy-same-host.md](docs/deploy-same-host.md).
- **Palworld in Docker:** publish the port as `127.0.0.1:8212:8212`, never `8212:8212`.
- **PalOps elsewhere (e.g. Railway):** reach the server over Tailscale, WireGuard or another private tunnel, or allow only PalOps' fixed outbound IP. See [docs/deploy-railway.md](docs/deploy-railway.md#reaching-your-palworld-server-from-railway).

### Troubleshooting

| Panel message | What to check |
| --- | --- |
| Could not reach the server | `RESTAPIEnabled=True`, the server restarted after the edit, the host and port are right, and the firewall allows PalOps' machine |
| The server did not respond in time | The server is still starting, or a firewall is silently dropping the port (5 second timeout) |
| The server rejected the admin credentials | The password doesn't match `AdminPassword`, or the username isn't `admin` |
| World page says world data is switched off | Start the server with `-enable-gamedata-api` (see step 4) |
| The server returned HTTP 404 | The port belongs to something else, or the Palworld server is too old to have the REST API (update it) |

To try the panel without a server, choose **Mock server** as the connection type (or run `npm run dev`, which connects it for you).

## Roles

| Permission | Owner | Admin | Moderator | Viewer |
| --- | :-: | :-: | :-: | :-: |
| View dashboard, server info, online players | ✓ | ✓ | ✓ | ✓ |
| Guilds and their members | ✓ | ✓ | ✓ | ✓ |
| Kick players, add moderation notes | ✓ | ✓ | ✓ | |
| World map, bases, performance, cheat signals | ✓ | ✓ | ✓ | |
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
deploy/same-host/      Compose + Caddy for running next to the Palworld server
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
| GET | `/players/known`, `/players/bans`, `/players/:userId` | `players.view` (everyone seen, panel bans, a player's profile and history) |
| POST | `/players/:userId/kick` | `players.kick` |
| POST | `/players/:userId/ban`, `/players/:userId/unban` | `players.ban` |
| POST/DELETE | `/players/ip-bans`, `/players/ip-bans/:id` | `players.ban` (ban and unban an address; listed with `/players/bans` for `world.view`) |
| POST | `/players/:userId/notes` | `players.note` |
| POST | `/server/save`, `/server/shutdown`, `/server/stop` | `server.control` |
| GET/PUT | `/paldefender/settings` | `server.connection` (optional PalDefender integration; the token is never returned) |
| POST | `/paldefender/test` | `server.connection` |
| GET | `/paldefender/status` | `players.view` |
| GET | `/paldefender/banlist` | `world.view` (PalDefender's ban list) |
| POST | `/paldefender/unban`, `/paldefender/unbanip` | `players.ban` (lift an entry from PalDefender's list) |
| GET | `/paldefender/players/:userId/pals`, `/items`, `/techs`, `/progression`; `/paldefender/guilds`, `/guilds/:id` | `world.view` (online players only) |
| POST | `/paldefender/players/:userId/give/{items,pals,eggs,templates,progression}`, `/tech/{learn,forget}` | `paldefender.manage` |
| POST | `/paldefender/summon/{pal,npc}`, `/paldefender/bases/:id/delete`, `/paldefender/reload-config` | `paldefender.manage` |
| POST | `/paldefender/alert`, `/paldefender/broadcast` | `server.broadcast` |
| POST | `/paldefender/message` | `players.kick` (chat or log messages to chosen players) |
| GET | `/config` | `config.view` (live settings from the REST API) |
| GET | `/world/status`, `/world/guilds`, `/world/guilds/:guildId` | `players.view` (world data state, guilds and their members) |
| GET | `/world/map`, `/world/bases`, `/world/signals`, `/world/performance` | `world.view` (positions, bases, cheat signals, FPS and hotspots) |
| POST | `/world/refresh` | `world.view` (read a snapshot now) |
| POST | `/world/signals/:id/dismiss` | `players.note` |
| GET | `/world/map-image`, `/world/map-image/file` | `world.view` (the live map's background and its alignment) |
| PUT/PATCH/DELETE | `/world/map-image` | `config.edit` (upload as a raw PNG/JPEG/WebP body up to 25 MB, align, remove) |
| GET | `/logs/audit` | `audit.view` |
| GET | `/console/lines`, `/console/stream` | `console.view` (view-only console: history and a live server-sent event stream) |
| GET/PUT | `/console/settings`, POST `/console/settings/test` | `server.connection` (where the game and PalDefender log files are, and the PalServerLogger websocket) |
| POST | `/discord/interactions` | public, but every request must carry Discord's signature (slash commands arrive here) |
| GET/PUT | `/discord-bot/settings`; POST `/discord-bot/test`, `/register-commands`, `/send-test` | `server.connection` (the optional Discord bot; the token is never returned) |
| GET | `/public/server`, `/public/players`, `/public/guilds` | public, CORS open, no IPs, platform IDs or positions |
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
