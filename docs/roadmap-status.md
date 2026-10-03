# Roadmap status

Tracks progress against the development priority order in the project roadmap.

| # | Phase | Status |
| --- | --- | --- |
| 1 | Project foundation | Done: monorepo, Fastify API, SQLite + migrations, React dashboard shell, shared UI components |
| 2 | Authentication & roles | Done: Discord OAuth2 as main sign-in (owners add users by Discord ID), optional password sign-in, first-run owner setup, sessions, owner-issued reset links, 4 roles enforced server-side, user management |
| 3 | Server connection layer | Done: `PalworldAdapter` interface, official REST API adapter, mock adapter, encrypted connection settings, connection test, status endpoint |
| 4 | Dashboard | Status, info, player count, FPS/frame time, broadcast, and the server FPS graph with average and lowest (from world snapshots, staff only). Host CPU/RAM pending |
| 5 | Player management | Done for the REST API: online list, all known players with search, profiles, kick/ban/unban with reasons, ban by platform ID, staff notes, moderation history. Every address a player has connected from is recorded (staff with `players.ip` only), shown on profiles with the other accounts that share it, and can be banned, alone or as a CIDR range. The game only bans accounts, so PalOps enforces address bans itself: anyone connecting from one is kicked at the next check (about 20 seconds). Bans have their own page and, with the players list, can be exported as CSV (audited; addresses only for staff with `players.ip`). The Players page has an Activity tab (unique players, playtime, average visit, peak online, busiest hours) and profiles show playtime windows and a daily chart. Bans made outside PalOps can't be listed through the API |
| 6 | Console | View-only live console: panel events plus the game's and PalDefender's log files tailed from disk, with filter, search, pause and download ([console.md](console.md)). No commands: Palworld has deprecated RCON. Optionally the PalServerLogger websocket for the game's real console output |
| 7 | Configuration | Read-only: live settings grouped and searchable. Editing needs host access to `PalWorldSettings.ini` |
| 8 | Logs | Audit log with category filter and pagination; the Console page covers the game and PalDefender log files |
| 9 | Server controls | Save, shutdown with countdown and message, force stop, and scheduled restarts and world saves (Server → Restarts and saves; the server's service manager starts it again). Starting a stopped server on demand needs a process manager integration |
| 10 | Backups | Not started |
| 11 | Real-time updates | Not started (UI polls every 10-15s for now) |
| 12 | Security hardening | Baseline in place (see README) |
| 13 | Testing | Server tests for auth, permissions, CSRF, validation, moderation, world data and the Palworld adapter |
| 14 | Deployment | Dockerfile, same-machine Compose + Caddy setup ([deploy-same-host.md](deploy-same-host.md), recommended), Railway config and guide ([deploy-railway.md](deploy-railway.md)), comparison ([deployment.md](deployment.md)), health check |

## Public website (extra)

Public server site at `/` with Discord player sign-in and character profiles (level, guild, first/last seen).
Character links are verified by an in-game code (sent through PalDefender) or by an admin, and only verified links earn roles or carry bans. The site has a player directory and
profile pages with playtime, pals and guild, and the panel's player views show playtime, filters and the Discord link. See [player-accounts.md](player-accounts.md).

## World data (extra)

From the REST API's world snapshot (`-enable-gamedata-api`), polled every 20 seconds:

- Guilds with members and bases, also filling in guilds on player lists, profiles and the public site.
- A live map for staff with players, bases, pals and NPCs, in in-game map coordinates, with names on players, bases, pals and NPCs (labels thin out when crowded, and details show on hover), over map images an owner or admin uploads and lines up with two points, one each for Palpagos Islands and the World Tree, which land next to each other as in the game (the game's map art isn't ours to ship).
- Bases with their worker pals, levels and HP, and injured workers flagged.
- Pals seen with each player, kept for 30 days.
- Cheat signals: unusual movement, level jumps, players sharing an address and base intrusions (a player outside a guild standing at its Pal Box, useful on PvP servers), with dismissal recorded in the audit log.
- Lag hotspots: FPS over time and the busiest 500 m areas, kept for 7 days.

## PalDefender (optional)

An opt-in integration with the [PalDefender](https://ultimeit.github.io/PalDefender/) plugin for Windows servers, off unless an owner turns it on
in Settings: bans and address bans mirrored to PalDefender, its ban list shown on the Bans tab, player addresses synced from it, and a PalDefender page
and player panel for inventories, pals, technologies, progression, guilds and bases, giving, summoning, base deletion, config reload and messages. See [paldefender.md](paldefender.md).

## Shared banlist network (optional)

An opt-in integration with a shared banlist network for Palworld servers such as PalBan Network, off unless an owner turns it on: your server's banlist there next to the game's, with
banning in the game one player at a time on a person's confirmation (never automatic), a CSV export for adding local bans there, lookups on player profiles and at join, and joins and
bans reported. It shares information about cheaters, with proof, and is never meant to control another server's ban decisions. See [palban.md](palban.md).

## Discord bot (optional)

Slash commands that map each Discord user to a panel user by Discord ID and enforce that user's role (including `/ban @member`), notifications to an events channel, log
forwarding, a live connection that shows the player count (Do Not Disturb when the server is offline or restarting) and can rename a status channel, roles and nicknames from
verified links and panel roles, joining the Discord server on website sign-in, bans kept in step both ways for verified links, and a chat relay between the game and a channel.
Off unless an owner enables it; see [discord-bot.md](discord-bot.md).

## Known limitations

- The official REST API has no console and no way to *start* a stopped server. Palworld has deprecated RCON, so PalOps doesn't use it: the console is view-only,
  and start/restart will need a process manager integration (Docker or systemd).
- Rate limiting is in memory, which is fine for a single panel process.
