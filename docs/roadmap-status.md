# Roadmap status

Tracks progress against the development priority order in the project roadmap.

| # | Phase | Status |
| --- | --- | --- |
| 1 | Project foundation | Done: monorepo, Fastify API, SQLite + migrations, React dashboard shell, shared UI components |
| 2 | Authentication & roles | Done: Discord OAuth2 as main sign-in (owners add users by Discord ID), optional password sign-in, first-run owner setup, sessions, owner-issued reset links, 4 roles enforced server-side, user management |
| 3 | Server connection layer | Done: `PalworldAdapter` interface, official REST API adapter, mock adapter, encrypted connection settings, connection test, status endpoint |
| 4 | Dashboard | Basic: status, info, player count, FPS/frame time, broadcast. Host CPU/RAM pending |
| 5 | Player management | Done for the REST API: online list, all known players with search, profiles, kick/ban/unban with reasons, ban by platform ID, staff notes, moderation history. Bans made outside PalOps can't be listed through the API |
| 6 | Console | Blocked on the REST API (no console). Needs RCON or PalOps on the game machine |
| 7 | Configuration | Read-only: live settings grouped and searchable. Editing needs host access to `PalWorldSettings.ini` |
| 8 | Logs | Started: audit log with category filter and pagination |
| 9 | Server controls | Save, shutdown with countdown and message, force stop. Start/restart needs a process manager integration |
| 10 | Backups | Not started |
| 11 | Real-time updates | Not started (UI polls every 10-15s for now) |
| 12 | Security hardening | Baseline in place (see README) |
| 13 | Testing | Server tests for auth, permissions, CSRF, validation and the Palworld adapter |
| 14 | Deployment | Dockerfile, same-machine Compose + Caddy setup ([deploy-same-host.md](deploy-same-host.md), recommended), Railway config and guide ([deploy-railway.md](deploy-railway.md)), comparison ([deployment.md](deployment.md)), health check |

## Public website (extra)

Public server site at `/` with Discord player sign-in and character profiles (level, guild, first/last seen).
Character links are unverified for now; verification needs staff review or an in-game code via a server plugin.

## Discord bot (planned)

Panel users are linked to Discord ids, so a bot in `server/src/services/discord/` can resolve the Discord user
behind a command to a panel user and reuse the same permission checks. It will need `DISCORD_BOT_TOKEN`
and a guild id; nothing bot-related runs yet.

## Known limitations

- The official REST API has no console/RCON command channel and no way to *start* a stopped server.
  Console and start/restart will need an additional adapter (RCON and/or a process manager such as Docker or systemd).
- Rate limiting is in memory, which is fine for a single panel process.
