# Local setup and testing

Run the whole thing on your own computer: public website, staff panel, a fake Palworld server and a local stand-in
for Discord. No Discord app or game server needed.

## Requirements

- Node.js 20.12 or newer (`node -v`)
- Git

## First time

```bash
git clone https://github.com/Faire-sdk/palops.git
cd palops
npm run setup      # installs dependencies and writes server/.env with local defaults
npm run dev        # starts the API (port 8080) and the web app (port 5173)
```

Open:

| | |
| --- | --- |
| Public website | http://localhost:5173 |
| Staff panel | http://localhost:5173/panel |
| API health | http://localhost:5173/api/health |

Code changes reload by themselves: the API restarts, and the browser hot-reloads.

## What the local defaults give you

`npm run setup` writes `server/.env` (it never overwrites an existing one):

- **`DEV_DISCORD_LOGIN=true`**: "Sign in with Discord" opens a local page where you pick who to sign in as
  (an owner, a staff member, a player, or any Discord ID you type). Everything after that is the real sign-in code.
  This only works with `NODE_ENV=development`; the server refuses to start with it anywhere else.
- **`DEV_MOCK_SERVER=true`**: the panel connects to a built-in mock Palworld server with three players online.
- **`PANEL_SETUP_TOKEN=local-setup-token`**: the setup token for creating the owner.
- **`AUTH_PASSWORD_LOGIN=true`**: password sign-in is available too.

## Try each flow

**Owner setup**

1. Open http://localhost:5173/panel.
2. Enter `local-setup-token` and click **Continue with Discord**.
3. Pick **Owner**. You land on the dashboard with the mock server online.

**Staff access**

1. As the owner, go to **Settings → Users → Add user**. Enter username `mod`, Discord user ID `100000000000000002`
   and role `moderator`.
2. Sign out, then sign in with Discord and pick **A staff member**. The sidebar shows only what a moderator can use.
3. Sign in as someone else with an ID that isn't on the list. You're refused and shown your ID.

**Player website**

1. Open http://localhost:5173 in a private window, so it doesn't share cookies with your panel session.
2. Click **Sign in** and pick **A player**.
3. On **My character**, link `Lamball Enjoyer` (or `Anubis`, `CattivaFan`). You see level, guild and online status.
4. Player accounts can't open the panel: http://localhost:5173/panel still asks you to sign in.

**Offline and errors**

- In the panel, set **Settings → Server connection** to Palworld REST API with host `127.0.0.1` and port `1`, then
  save. The dashboard shows the server as offline, and the website shows it offline too.

## Using a real Palworld server locally

In **Settings → Server connection**, choose **Palworld REST API** and enter the server's address, REST API port
(default `8212`) and `AdminPassword`. The game server needs `RESTAPIEnabled=True` in `PalWorldSettings.ini`.

## Using your real Discord application locally

1. In the [Discord Developer Portal](https://discord.com/developers/applications), add
   `http://localhost:5173/api/v1/auth/discord/callback` under **OAuth2 → Redirects**.
2. In `server/.env`, set `DEV_DISCORD_LOGIN=false` and fill in `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` and
   `DISCORD_REDIRECT_URI=http://localhost:5173/api/v1/auth/discord/callback`.
3. Restart `npm run dev`.

Use the `5173` address in the browser, the same one as the redirect. Opening `8080` directly breaks the sign-in
because the redirect goes back to a different address.

## Tests and checks

```bash
npm test            # API tests (Vitest), including the Discord and website flows
npm run typecheck   # server and web
npm run build       # production build
```

## Start over

```bash
npm run reset:local   # deletes the local database; keeps server/.env
```

The next start begins at first-run setup again (the mock server reconnects on its own).

## Run the production image locally

To check the Docker image Railway builds:

```bash
docker compose up --build
```

Then open http://localhost:8080 (website) and http://localhost:8080/panel (setup token `local-setup-token`, password
sign-in). Data is kept in the `palops-data` volume; `docker compose down -v` removes it.

## Troubleshooting

- **`EADDRINUSE`**: something already uses port 8080 or 5173. Stop it, or change `PORT` in `server/.env` and the
  proxy target in `web/vite.config.ts`.
- **"Invalid state" after signing in**: the sign-in started on one address and finished on another (for example
  `127.0.0.1` versus `localhost`). Stick to `http://localhost:5173`.
- **`better-sqlite3` fails to install**: use a current Node LTS (20 or 22). On unusual platforms it compiles from
  source and needs Python and a C++ compiler.
