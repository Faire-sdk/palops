# PalDefender integration (optional)

[PalDefender](https://ultimeit.github.io/PalDefender/) is a Windows server plugin with anti-cheat, its own ban list and a REST API.
PalOps works fully without it. This integration is **off by default**: nothing calls PalDefender, polls it or shows anything
about it until an owner switches it on in **Settings → PalDefender**.

## What it adds

With the integration on:

- **Bans are mirrored.** Banning a player in PalOps also bans them in PalDefender; "also ban their IP address" and manual address bans
  use PalDefender's native IP bans, so a banned address is refused by the plugin itself instead of only by PalOps's own check.
  Unbans (including the addresses banned with a player) are mirrored the same way.
- **PalDefender's ban list is shown** on **Players → Bans**, including bans made in-game, by its anti-cheat and by other tools, which the
  official REST API can't list. Admins can lift an entry from there.
- **Player addresses are synced** every minute, including players who are offline, so profiles show more addresses and banned addresses are
  caught on accounts PalOps hasn't seen online.

The official Palworld REST API stays the source of truth. If PalDefender is unreachable or the token lacks a permission, the ban or unban
still happens through the official API and PalOps tells you that PalDefender's list wasn't updated.

## Set it up

1. On the game server, open `Win64/PalDefender/RESTAPI/RESTConfig.json`, set `"Enabled": true` and restart the server.
   The API listens on `127.0.0.1:17993` by default.
2. Add a token file in `Win64/PalDefender/RESTAPI/Tokens/` with only the permissions PalOps needs:

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
       "REST.Punishments.UnbanIP"
     ]
   }
   ```

3. In PalOps, open **Settings → PalDefender** (owners only), enter the host, port and token, and press **Test connection**. It tries each read
   the panel relies on and names any permission the token is missing. Then switch **Use PalDefender** on and save.

## Where the panel runs

PalDefender's API is meant for the same machine, so the [same-host deployment](deploy-same-host.md) with host `127.0.0.1` is the natural fit (if PalOps runs in a container, use an address the container can reach). **Don't expose port 17993 to the internet.** To reach it
from another machine, put a reverse proxy with TLS in front, and tick **Connect over HTTPS**. On Railway or another host that can't reach the
game machine, leave the integration off.

The token is encrypted at rest and never sent back to the browser. Changes to these settings are recorded in the audit log without the token.

## Limits

- PalDefender is Windows-only, so this only applies to Windows servers.
- Unbanning an entry from the PalDefender list changes only PalDefender's list. To fully unban someone banned from PalOps, use Unban in the
  PalOps list, which lifts the game ban, the panel's address bans and PalDefender's.
- Kicks, the console, item and pal giving, and PalDefender's other endpoints aren't used yet.
