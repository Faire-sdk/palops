# Console

The **Console** page is a live, **view-only** feed. It shows:

- **Panel events**: players joining and leaving, admin actions (kicks, bans, gives, settings changes), and cheat signals. This needs nothing set up.
- **The game's log file**, if an owner has pointed PalOps at it.
- **PalDefender's log files**, the same way. This reads the files PalDefender writes and is separate from its REST API integration.
- **The PalServerLogger websocket**, optional, for the game's real console output on Windows servers.

You can filter by source, show only warnings or errors, search, pause, and download what you're looking at. Lines are kept for a week (at most 100,000).
It needs the `console.view` permission, which admins and owners have.

## There's no command box

Palworld has deprecated RCON ("RCON is scheduled to stop functioning in an upcoming update") and it has a bug with multi-byte player names, so PalOps doesn't
use it. Use the **Players**, **Server** and **PalDefender** pages for what people usually type: kick, ban, broadcast, save, shutdown, give, summon.
`console.execute` stays defined but nothing uses it.

## Set up the log files (owners)

PalOps has to be able to read the files, so this is for PalOps running on the game machine, or with the folders mounted into its container.
In **Settings → Console logs**:

| Field | Typical location |
| --- | --- |
| Game log file or folder | `<PalServer>/Pal/Saved/Logs` (Palworld normally writes `Pal.log` there) |
| PalDefender log folder | `<PalServer>/Pal/Binaries/Win64/PalDefender/Logs` (from PalDefender's FAQ) |

Use **Check paths**, then switch **Follow these log files** on and save.

- A **folder** follows every `.log`, `.txt` and `.out` file in it (and one folder level down) that changed in the last day, so a new day's file is picked up by itself.
- A **file** must have one of those extensions. Hidden files aren't read.
- PalOps never reads its own data folder, and follows symlinks only to their real location before checking that.
- The first time it sees a file it shows the last ~100 lines; after that only new lines, and it remembers where it got to across restarts.
- Rotated or truncated files are followed from the top again.
- Lines are decoded as UTF-8, with colour codes and control characters removed. PalDefender's line format isn't documented, so its lines are shown as written.

Anyone who can open the Console can read whatever these files contain, including player names and the addresses PalDefender logs. Only point PalOps at logs you're
comfortable admins seeing.

### Docker

Mount the folders read-only and enter the path as the container sees it:

```yaml
services:
  palops:
    volumes:
      - /srv/palworld/Pal/Saved/Logs:/logs/game:ro
      - /srv/palworld/Pal/Binaries/Win64/PalDefender/Logs:/logs/paldefender:ro
```

Then use `/logs/game` and `/logs/paldefender` in the settings. Behind a reverse proxy, make sure it doesn't buffer `/api/v1/console/stream` (PalOps sends
`X-Accel-Buffering: no`, which nginx honours; Caddy streams it by default).

## How it works

Log files are polled once a second, read from where PalOps left off, split into whole lines, and stored. The page loads recent history and then follows a server-sent
event stream (`GET /api/v1/console/stream`), which reconnects by itself and catches up on what it missed. Up to 20 viewers can stream at once.

## PalServerLogger (optional, Windows)

[PalServerLogger](https://github.com/GlitchApotamus/PalServerLogger) is a DLL loaded into the game server. It captures the server's console output and serves it over a
websocket (default `127.0.0.1:8765`). PalOps can connect to it for the real console stream, which the log files don't fully contain. It's another plugin in the game
process, so only add it if you want it.

In **Settings → Console logs → PalServerLogger websocket**, enter the host, port and the `websocket_secret` from PalServerLogger's `Config.json`, and use **Check**
to try the connection. PalOps sends the secret in an `Authorization: Bearer` header (never in a URL), reconnects with a growing pause when the server is away, and shows
why it can't connect (wrong secret, nothing listening, unreachable). The secret is encrypted at rest.

PalServerLogger's documented message is `{"type":"log","message":"..."}`. Other message types aren't documented, so PalOps ignores them. If you also follow the game's log
file, lines can appear twice: use one or the other for the game log.

## Not built yet

- A journald or `docker logs` source for Linux setups without log files.
