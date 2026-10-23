# Shared banlist network (optional)

PalOps can connect to a shared banlist network for Palworld servers, such as PalBan Network: a service where each server keeps its own banlist and shares information about
cheaters, with proof, with the other servers that take part. It is off until an owner turns it on in **Settings → Integrations**, and while it's off nothing here runs and the
service isn't named anywhere else in the panel.

**Nothing here acts by itself.** A ban on the network never becomes a ban in the game, and a lift on the network never becomes an unban, unless a person on your team
confirms it, one player at a time. A report from another server is a lead for your team, never a ban.

## What this is for

The network shares information about cheaters, with proof, between servers. This integration is never meant to control another server's banlist or its ban decisions, or to
decide whether a particular player can play on the servers that take part. Your team decides what happens on your server: PalOps never bans or unbans because of the network by
itself, and nothing it sends can ban anyone there. PalOps says so on the settings page and on the Bans page next to the network's banlist.

## Setting it up

1. On the network, make an integration key for your server (shown once). Keep the default permissions: read status, players and banlist, and send events.
2. In PalOps, **Settings → Integrations** (owners only): set up the network, enter its address and the key, press **Test key** (it says which server the key is for and whether any
   permission is missing), then switch it on and save.

The key is stored encrypted and never returned or written to the audit log. Redirects aren't followed, so the key can't be sent anywhere you didn't type in.

## What it does

| | |
| --- | --- |
| **Banlist** | Reads your server's banlist on the network every 5 minutes (and on **Read now**): everything the first time and once a day, then only what changed. Lifted and expired bans come through too. |
| **Bans page** | Shows that banlist next to the game's: which active bans are **not banned in the game yet**, with **Ban in game** for each (it asks you to confirm and reminds you that a ban may have been merged from another server, so check the reason first). A ban lifted on the network that PalOps applied earlier shows **Unban in game**, also on your confirmation. A second list shows players banned here but not on the network, with an export as a CSV the network can import (IPs only for staff who can see them, Discord only for verified links). |
| **Player lookup** | A section on player profiles (moderators and up): your bans of the player, how many other servers have active bans on them and their reasons, plus anticheat detections your integrations sent. |
| **Join checks** | Looks each player up when they join (at most once every 6 hours). If they have an active ban on your list or on other servers, it's written to the audit log and posted to Discord's staff heads-up channel (the "signals" notifications) when the Discord bot is on. |
| **PalDefender log lines** | Optional, and only when the PalDefender integration is on and its log folder is set under Settings, Console logs. PalOps forwards the lines PalDefender writes about suspected cheaters (`... may be a cheater! Reason: ...`, `... is a cheater! Reason: ...`) so they can be reviewed there. Chat and the rest of the log never leave the server. Player IPs are removed from the lines unless you allow them. Each line goes with the time PalOps saw it (PalDefender's lines have a time but no date), and lines that fail are kept and retried. |
| **Events out** | Tells the network about joins, leaves and bans/unbans made here. Events are queued and retried if it is unreachable. **IPs are never sent.** |

## Permissions

| Action | Needs |
| --- | --- |
| Settings, test | `server.connection` (owner), under Settings, Integrations |
| See the banlist comparison | `players.view` |
| Read now, Ban in game, export | `players.ban` (admin and up); IPs in the export also need `players.ip` |
| Player lookup on a profile | `world.view` (moderator and up) |

## Alternatives

Palworld itself can follow a banlist file through `BanListURL` in `PalWorldSettings.ini`, and some services serve one for your server without PalOps at all. You can also host one
yourself, for example with [projectsphere/banlist-api](https://github.com/projectsphere/banlist-api). Use this integration when you also want the comparison, the profile lookups
and joins and bans reported back, or use it alongside them.

## PalDefender

This integration is independent of PalDefender. PalOps only talks to PalDefender through its own REST API with a token you create, as described in
[paldefender.md](paldefender.md), and nothing here asks PalDefender to take part in a shared banlist.

## Limits

- The network's integration API has no call to add or remove a ban, so PalOps can't push bans; use the export and the network's CSV import.
- A ban deleted (rather than lifted) on the network is noticed by the daily full read.
- Lookups and the banlist read share the network's rate limits per key; joins are throttled to fit.
