# PalDefender integration (optional)

[PalDefender](https://ultimeit.github.io/PalDefender/) is a Windows server plugin with anti-cheat, its own ban list and a REST API.
PalOps works fully without it. This integration is **off by default**: nothing calls PalDefender, polls it or shows anything
about it until an owner switches it on in **Settings → PalDefender**.

## What it adds

With the integration on, a **PalDefender** page appears in the sidebar and a **PalDefender** button on the profile of any online player.

**Bans**
- Banning a player in PalOps also bans them in PalDefender; "also ban their IP address" and manual address bans use PalDefender's native IP bans,
  so a banned address is refused by the plugin itself instead of only by PalOps's own check. Unbans (including the addresses banned with a player)
  are mirrored the same way.
- PalDefender's ban list is shown on **Players → Bans**, including bans made in-game, by its anti-cheat and by other tools, which the official
  REST API can't list. Admins can lift an entry from there.
- Player addresses are synced every minute, including for offline players, so profiles show more addresses and banned addresses are caught on
  accounts PalOps hasn't seen online.

**A player's data** (moderators and up; the player must be online, because that is what PalDefender exposes)
- **Inventory** in every container, **pals** (party, palbox and each base), **technologies** and **progression**.

**Guilds and bases** (moderators and up), on the PalDefender page
- Every guild with its leader, members, bases, storage and current research.

**Changing the game world** (admins and owners, all recorded in the audit log)
- **Give** items, pals, eggs and pal templates, and experience, technology points, ancient points and relics.
- **Learn or forget technologies**, including all of them.
- **Summon** a pal (by ID or template file) or an NPC at coordinates, with options such as not capturable and no AI.
- **Delete a base** with its buildings, storage and pals. It asks for confirmation; PalDefender archives what it removed.
- **Reload PalDefender's config** after editing `Config.json`.

**Messages**
- An on-screen **alert** or a **chat message** to everyone (whoever can broadcast), and **messages to specific players** as chat or as a log line at
  three levels (moderators and up).

The official Palworld REST API stays the source of truth for bans. If PalDefender is unreachable or the token lacks a permission, a ban or unban
still happens through the official API and PalOps tells you that PalDefender's list wasn't updated. PalDefender's own refusals (an unknown item ID,
no storage space) are shown to you as PalDefender words them.

## Who can do what

| In PalOps | Needs | PalDefender token permission |
| --- | --- | --- |
| See inventory, pals, techs, progression, guilds, the ban list | `world.view` (moderator and up) | `REST.Items.Read`, `REST.Pals.Read`, `REST.Techs.Read`, `REST.Progression.Read`, `REST.Guilds.Read`, `REST.Guild.Read`, `REST.Banlist.Read` |
| Address sync | (automatic) | `REST.Players.Read`, `REST.Version.Read` |
| Bans mirrored, lift entries from PalDefender's list | `players.ban` (admin and up) | `REST.Punishments.Ban`, `.Unban`, `.BanIP`, `.UnbanIP` |
| Give items, pals, eggs, templates | `paldefender.manage` (admin and up) | `REST.Items.Give`, `REST.Pals.Give`, `REST.PalEggs.Give`, `REST.PalTemplates.Give` |
| Give progression | `paldefender.manage` | `REST.Progression.Give` |
| Learn or forget technologies | `paldefender.manage` | `REST.Techs.Learn`, `REST.Techs.Forget` |
| Summon | `paldefender.manage` | `REST.Summon.Pal`, `REST.Summon.NPC` |
| Delete a base | `paldefender.manage` | `REST.Base.Delete` |
| Reload PalDefender's config | `paldefender.manage` | `REST.Reload.Config` |
| Alert and chat broadcast | `server.broadcast` (admin and up) | `REST.Messages.Alert`, `REST.Messages.Broadcast` |
| Message specific players | `players.kick` (moderator and up) | `REST.Messages.Send.PlayerChat`, `.GlobalChat`, `.GuildChat`, `.Log.Normal`, `.Log.Important`, `.Log.VeryImportant` (only the ones you use) |

Give the token only what you use. The setup guide below has a starting point.

## Set it up

1. On the game server, open `Win64/PalDefender/RESTAPI/RESTConfig.json`, set `"Enabled": true` and restart the server.
   The API listens on `127.0.0.1:17993` by default.
2. Add a token file in `Win64/PalDefender/RESTAPI/Tokens/`. This one covers the reads, address sync and bans; add the give, summon, tech, message,
   base and reload permissions from the table above for the features you'll use:

   ```json
   {
     "Name": "PalOps",
     "Token": "<a long random string>",
     "Permissions": [
       "REST.Version.Read",
       "REST.Players.Read",
       "REST.Banlist.Read",
       "REST.Punishments.Ban",
       "REST.Punishments.Unban",
       "REST.Punishments.BanIP",
       "REST.Punishments.UnbanIP",
       "REST.Guilds.Read",
       "REST.Guild.Read",
       "REST.Pals.Read",
       "REST.Items.Read",
       "REST.Techs.Read",
       "REST.Progression.Read"
     ]
   }
   ```

3. In PalOps, open **Settings → PalDefender** (owners only), enter the host, port and token, and press **Test connection**. It tries the reads
   the panel relies on and names any permission the token is missing. Then switch **Use PalDefender** on and save.

## Where the panel runs

PalDefender's API is meant for the same machine, so the [same-host deployment](deploy-same-host.md) with host `127.0.0.1` is the natural fit (if PalOps runs in a container, use an address the container can reach). **Don't expose port 17993 to the internet.** To reach it
from another machine, put a reverse proxy with TLS in front, and tick **Connect over HTTPS**. On Railway or another host that can't reach the
game machine, leave the integration off.

The token is encrypted at rest and never sent back to the browser. Changes to these settings are recorded in the audit log without the token.

## Limits

- PalDefender is Windows-only, so this only applies to Windows servers.
- PalDefender reads and changes only players who are online.
- Unbanning an entry from the PalDefender list changes only PalDefender's list. To fully unban someone banned from PalOps, use Unban in the
  PalOps list, which lifts the game ban, the panel's address bans and PalDefender's.
- Kicks and the server-wide announcement still use the official REST API, which does the same job. Eggs are given by Pal ID in the panel; to give one
  from a template file, call PalDefender directly. PalDefender's deprecated `/give` endpoint isn't used.
