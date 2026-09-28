# PalBan Network (optional)

[PalBan Network](https://github.com/Faire-sdk/PalBanNetwork) is a shared banlist for Palworld servers: each server keeps its own banlist, sees when a
player it banned is also banned elsewhere, and can merge other servers' bans by choice. PalOps connects to it through its integration API. It is off
until an owner turns it on in **Settings → Integrations → PalBan Network**, and while it's off nothing here runs.

**Nothing here acts by itself.** A ban on PalBan never becomes a ban in the game, and a lift on PalBan never becomes an unban, unless a person on your team
confirms it, one player at a time. A report from another server is a lead for your team, never a ban.

## What this is for

PalBan Network shares information about cheaters, with proof, between servers. This integration is never meant to control another server's banlist or its ban decisions, or to decide whether a
particular player can play on the servers that take part. Your team decides what happens on your server: PalOps never bans or unbans because of PalBan by itself, and nothing it sends can ban anyone on PalBan.
PalOps says so on the settings page and on the Bans page next to the PalBan banlist.

## Setting it up

1. On PalBan Network, open your server's **Integrations** tab, choose **Another tool**, and connect. Copy the key (`pbn_...`); it's shown once.
   Keep the default permissions (read status, players and banlist, send events).
2. In PalOps, **Settings → Integrations → PalBan Network** (owners only): enter the site's address (for example `https://palban.net`) and the key, press
   **Test key** (it says which PalBan server the key is for and whether any permission is missing), then switch it on and save.

The key is stored encrypted and never returned or written to the audit log. Redirects aren't followed, so the key can't be sent anywhere you didn't type in.

## What it does

| | |
| --- | --- |
| **Banlist** | Reads your server's PalBan banlist every 5 minutes (and on **Read now**): everything the first time and once a day, then only what changed. Lifted and expired bans come through too. |
| **Bans page** | Shows the PalBan banlist next to the game: which active bans are **not banned in the game yet**, with **Ban in game** for each (it asks you to confirm and reminds you that a ban may have been merged from another server, so check the reason first). A ban lifted on PalBan that PalOps applied earlier shows **Unban in game**, also on your confirmation. A second list shows players banned here but not on PalBan, with **Export for PalBan**, a CSV PalBan's importer reads without mapping (addresses only for staff who can see them, Discord only for verified links). |
| **Player lookup** | A **PalBan Network** section on player profiles (moderators and up): your bans of the player, how many other servers have active bans on them, and their reasons, plus anticheat detections your integrations sent. |
| **Join checks** | Looks each player up when they join (at most once every 6 hours). If they have an active ban on your list or on other servers, it's written to the audit log and posted to Discord's staff heads-up channel (the "signals" notifications) when the Discord bot is on. |
| **PalDefender log lines** | Optional, and only when the PalDefender integration is on and its log folder is set under Settings, Console logs. PalOps forwards the lines PalDefender writes about suspected cheaters (`... may be a cheater! Reason: ...`, `... is a cheater! Reason: ...`) to PalBan's logs API, so they fill its Reports tab. Chat and the rest of the log never leave the server. Player addresses are removed from the lines unless you allow them. Each line goes with the time PalOps saw it (PalDefender's lines have a time but no date), and lines that fail are kept and retried. |
| **Events out** | Tells PalBan about joins, leaves and bans/unbans made here, so they show up in its event history. Events are queued and retried if PalBan is unreachable. **Addresses are never sent.** |

## Permissions

| Action | Needs |
| --- | --- |
| Settings, test | `server.connection` (owner), under Settings, Integrations |
| See the banlist comparison | `players.view` |
| Read now, Ban in game, export | `players.ban` (admin and up); addresses in the export also need `players.ip` |
| Player lookup on a profile | `world.view` (moderator and up) |

## Alternative: the banlist link

PalBan Network can also serve a private `banlist.txt` link (Settings on your PalBan server) that Palworld itself reads through `BanListURL` in `PalWorldSettings.ini`.
That needs no PalOps at all and keeps the game server in step with your PalBan banlist. Self-hosted alternatives exist too, such as
[projectsphere/banlist-api](https://github.com/projectsphere/banlist-api), where you host a banlist yourself and point `BanListURL` at it. Use the integration here when you also
want the comparison, the profile lookups and joins and bans reported back, or use it alongside them.

## PalDefender

PalBan Network and this integration are independent of PalDefender. PalOps only talks to PalDefender through its own REST API with a token you
create, as described in [paldefender.md](paldefender.md), and nothing here asks PalDefender to take part in a shared banlist.

## When it is off

PalOps names PalDefender and PalBan Network in its screens only once you have switched them on. Until then the only place either appears is **Settings, Integrations** (owners), where you turn them on.

## Limits

- PalBan's API has no call to add or remove a ban, so PalOps can't push bans; use the export and PalBan's CSV import.
- A ban deleted (rather than lifted) on PalBan is noticed by the daily full read.
- Lookups and the banlist read share PalBan's rate limits per key (120 reads a minute); joins are throttled to fit.
