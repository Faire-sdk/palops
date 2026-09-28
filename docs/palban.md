# PalBan Network (optional)

[PalBan Network](https://github.com/Faire-sdk/PalBanNetwork) is a shared banlist for Palworld servers: each server keeps its own banlist, sees when a
player it banned is also banned elsewhere, and can merge other servers' bans by choice. PalOps connects to it through its integration API. It is off
until an owner turns it on in **Settings → PalBan Network**, and while it's off nothing here runs.

**Nothing here acts by itself.** A ban on PalBan never becomes a ban in the game, and a lift on PalBan never becomes an unban, unless a person on your team
confirms it, one player at a time. A report from another server is a lead for your team, never a ban. This is deliberate: a shared banlist that bans automatically
lets one person's ban, or one mistake or abuse, reach many servers that never chose it, and the server owner should stay the one who decides. Nothing PalOps sends can ban anyone on PalBan either.

## Know the risks

A shared banlist has real downsides, and they are why some server tool maintainers have chosen not to build one into their tools:

- **It can be abused.** Anyone with access to a team can add a ban that is unfair or built on false evidence, and if other teams copy it, that player can be locked out of servers that never looked into it.
- **Whoever controls a shared list has power over it.** A single party running one could lock a person out of many servers at will. That is why this integration never acts by itself, and why each team decides what to
  do with a ban.
- **A ban or report from another server is a lead, never proof.** Check the reason and the evidence, and hear the player out, before you act on one.

PalOps shows these on the settings page and on the Bans page, next to the PalBan banlist.

## Setting it up

1. On PalBan Network, open your server's **Integrations** tab, choose **Another tool**, and connect. Copy the key (`pbn_...`); it's shown once.
   Keep the default permissions (read status, players and banlist, send events).
2. In PalOps, **Settings → PalBan Network** (owners only): enter the site's address (for example `https://palban.net`) and the key, press
   **Test key** (it says which PalBan server the key is for and whether any permission is missing), then switch it on and save.

The key is stored encrypted and never returned or written to the audit log. Redirects aren't followed, so the key can't be sent anywhere you didn't type in.

## What it does

| | |
| --- | --- |
| **Banlist** | Reads your server's PalBan banlist every 5 minutes (and on **Read now**): everything the first time and once a day, then only what changed. Lifted and expired bans come through too. |
| **Bans page** | Shows the PalBan banlist next to the game: which active bans are **not banned in the game yet**, with **Ban in game** for each (it asks you to confirm and reminds you that a ban may have been merged from another server, so check the reason first). A ban lifted on PalBan that PalOps applied earlier shows **Unban in game**, also on your confirmation. A second list shows players banned here but not on PalBan, with **Export for PalBan**, a CSV PalBan's importer reads without mapping (addresses only for staff who can see them, Discord only for verified links). |
| **Player lookup** | A **PalBan Network** section on player profiles (moderators and up): your bans of the player, how many other servers have active bans on them, and their reasons, plus anticheat detections your integrations sent. |
| **Join checks** | Looks each player up when they join (at most once every 6 hours). If they have an active ban on your list or on other servers, it's written to the audit log and posted to Discord's staff heads-up channel (the "signals" notifications) when the Discord bot is on. |
| **Events out** | Tells PalBan about joins, leaves and bans/unbans made here, so they show up in its event history. Events are queued and retried if PalBan is unreachable. **Addresses are never sent.** |

## Permissions

| Action | Needs |
| --- | --- |
| Settings, test | `server.connection` (owner) |
| See the banlist comparison | `players.view` |
| Read now, Ban in game, export | `players.ban` (admin and up); addresses in the export also need `players.ip` |
| Player lookup on a profile | `world.view` (moderator and up) |

## Alternative: the banlist link

PalBan Network can also serve a private `banlist.txt` link (Settings on your PalBan server) that Palworld itself reads through `BanListURL` in `PalWorldSettings.ini`.
That needs no PalOps at all and keeps the game server in step with your PalBan banlist. Self-hosted alternatives exist too, such as
[projectsphere/banlist-api](https://github.com/projectsphere/banlist-api), where you host a banlist yourself and point `BanListURL` at it. Use the integration here when you also
want the comparison, the profile lookups and joins and bans reported back, or use it alongside them.

## PalDefender

PalBan Network and this integration are independent of PalDefender and are not endorsed by its maintainers. PalOps only talks to PalDefender through its own REST API with a token you
create, as described in [paldefender.md](paldefender.md), and nothing here asks PalDefender to take part in a shared banlist.

## Limits

- PalBan's API has no call to add or remove a ban, so PalOps can't push bans; use the export and PalBan's CSV import.
- A ban deleted (rather than lifted) on PalBan is noticed by the daily full read.
- Lookups and the banlist read share PalBan's rate limits per key (120 reads a minute); joins are throttled to fit.
