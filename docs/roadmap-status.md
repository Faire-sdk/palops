# Roadmap status

Tracks progress against the development priority order in the project roadmap.

| # | Phase | Status |
| --- | --- | --- |
| 1 | Project foundation | Done: monorepo, Fastify API, SQLite + migrations, React dashboard shell, shared UI components |
| 2 | Authentication & roles | Done: first-run owner setup, login/logout, sessions, password change, owner-issued reset links, 4 roles enforced server-side, user management |
| 3 | Server connection layer | Done: `PalworldAdapter` interface, official REST API adapter, mock adapter, encrypted connection settings, connection test, status endpoint |
| 4 | Dashboard | Basic: status, info, player count, FPS/frame time, broadcast. Host CPU/RAM pending |
| 5 | Player management | Started: online player list with search. Known-player history, profiles, kick/ban UI and moderation records next |
| 6 | Console | Not started |
| 7 | Configuration | Not started |
| 8 | Logs | Started: audit log with category filter and pagination |
| 9 | Server controls | Not started (REST API supports shutdown/stop; start needs a process manager integration) |
| 10 | Backups | Not started |
| 11 | Real-time updates | Not started (UI polls every 10-15s for now) |
| 12 | Security hardening | Baseline in place (see README) |
| 13 | Testing | Server tests for auth, permissions, CSRF, validation and the Palworld adapter |
| 14 | Deployment | Single-process production build and health check. Docker next |

## Known limitations

- The official REST API has no console/RCON command channel and no way to *start* a stopped server.
  Console and start/restart will need an additional adapter (RCON and/or a process manager such as Docker or systemd).
- Rate limiting is in memory, which is fine for a single panel process.
