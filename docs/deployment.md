# Choosing where to run PalOps

PalOps is one small app: the public server website at `/`, the staff panel at `/panel` and the API under `/api`.
It keeps its data in one SQLite file and talks to your Palworld server through the official REST API (port `8212` by default).

**The best choice for all the features is to run PalOps on the same machine as the Palworld server.**
Use another host only when you can't run anything next to the game server, and read what you give up below.

Don't have a game server yet? [deploy-vps.md](deploy-vps.md) rents one cheap VPS and runs the Palworld server, PalOps and HTTPS on it together.
Railway can't host the game server itself, because it doesn't accept UDP, which Palworld players connect over.

## Your options

| | Same machine as Palworld (recommended) | Managed cloud (Railway and similar) |
| --- | --- | --- |
| Guide | [deploy-same-host.md](deploy-same-host.md) | [deploy-railway.md](deploy-railway.md) |
| REST API port `8212` | Stays on `127.0.0.1`, never reachable from outside | Must be reached over a tunnel (Tailscale, WireGuard, Cloudflare Tunnel) or an IP allowlist |
| Status, players, kick, ban, announce, public website | Yes | Yes, while the tunnel is up |
| Start, stop and crash restart (planned) | Yes | No, the REST API can't start a stopped server |
| Server console and log files | Yes | Panel events only, the REST API has no logs |
| Backups of the save folder (planned) | Yes | No, the saves are on another machine |
| Guilds and base data read from save files (planned) | Yes | No, the REST API doesn't report guilds |
| Editing `PalWorldSettings.ini` (planned) | Yes | No |
| Extra cost | None; the panel needs about 100 MB of RAM next to Palworld's 16 GB or more | A second service, plus the tunnel |
| HTTPS and domain | Caddy in the same Compose file | Provided by Railway |

The "planned" rows are on the [roadmap](roadmap-status.md). They all need access to the game server's files or process,
which only a panel on the same machine has. On a managed host they would need a separate agent installed on the game machine,
which PalOps doesn't have yet.

## Why the same machine is the best choice

- **Security.** The REST API is protected only by the admin password and has no TLS.
  On the same machine the panel calls `http://127.0.0.1:8212`, so the port is never exposed and the password never crosses the internet.
- **Every feature works.** Starting a stopped server, reading console logs, taking backups and reading guilds from the save files all need the game machine.
- **Nothing extra to run.** No tunnel, no allowlist, no second bill. If the machine is up, the panel can reach the server.
- **Low overhead.** PalOps is a single Node process with SQLite. It uses a tiny fraction of what Palworld itself needs.

The one trade-off: if the whole machine goes down, the panel and website go down with it.
Keep backups of the PalOps database (`/data/panel.db`) somewhere other than that machine; the same-host guide shows how.

## When a managed host still makes sense

- Your Palworld server runs on a game host that doesn't let you run other programs (many rented "game server" plans).
- You want the public website to stay up while the game machine is being rebuilt.

In those cases use [Railway](deploy-railway.md), connect it to the game server over a private tunnel, and expect only the REST API features.

## Can the website and the panel run in different places?

Not today. The public website and the panel share the same database and the same connection to the game server,
so they run as one app. Running that one app on the game machine gives you both, with the website on your domain.
If you don't want to open ports 80 and 443 on the game machine, put it behind Cloudflare Tunnel instead
(see [the same-host guide](deploy-same-host.md#no-open-web-ports-cloudflare-tunnel)).
