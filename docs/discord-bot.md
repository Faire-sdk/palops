# Discord bot (optional)

The bot lets your staff check and moderate the server from Discord with slash commands, and posts server events to a channel. PalOps works fully
without it, and it stays off until an owner switches it on in **Settings → Discord bot**.

## How it works

The bot has two ways to talk to Discord, and uses both:

- **A live connection (the gateway).** This is what lets the bot show a status, see chat messages for the relay, and notice bans made in Discord. It also carries slash
  commands, so **PalOps doesn't need a public web address**: leave *Interactions Endpoint URL* empty in the Developer Portal and commands arrive over this connection.
- **Signed HTTPS requests (optional).** If you'd rather not keep a live connection just for commands, set the Interactions Endpoint URL to
  `https://<your panel>/api/v1/discord/interactions`. Every request is checked against Discord's Ed25519 signature and requests older than five minutes are refused.

Notifications and everything else the bot does go through Discord's REST API. The live connection reconnects by itself, resumes where it left off, and stops with a
clear message when it can't be fixed by retrying (a wrong token, or a privileged intent that's switched off).

## Who can do what

Each person who uses a command is matched to a **panel user by their Discord ID** (an owner sets it in Settings → Users). They can do only what that user's role
allows in the web panel:

| Command | Needs | Notes |
| --- | --- | --- |
| `/status` | `server.view` | Online or not, players, FPS, uptime |
| `/players` | `players.view` | Who is online |
| `/player <name>` | `players.view` | Level, guild, first and last seen, banned or not. No IPs. |
| `/kick <player> [reason]` | `players.kick` (moderators and up) | |
| `/ban <player> [reason] [ban_ip]` | `players.ban` (admins and up) | `ban_ip` also needs a role that can see IPs |
| `/unban <player> [reason]` | `players.ban` | |
| `/announce <message>` | `server.broadcast` | |
| `/save` | `server.control` | |

- Someone whose Discord account isn't linked can do nothing, and a disabled panel user can't either. With **Anyone in the Discord server can use /status and
  /players** switched on, `/status` and `/players` also work for everyone, and their reply is visible to the channel.
- Replies are private to whoever ran the command, except those public ones.
- `player` fields suggest known players as you type, but only to people allowed to see them.
- Actions are recorded in the audit log and the player's history under the panel user's name with "(via Discord)".
- Commands only work in the configured Discord server. Each person can run at most six commands in ten seconds.

## Status, and a status channel

With **Show the server in the bot's status** on, the bot shows **Online** with "*5/32 players*" while the server is up, and **Do Not Disturb** with "*Server offline*" or
"*Server restarting*" otherwise. "Restarting" starts the moment a shutdown is ordered from the panel (or the bot) and lasts until the server has gone down and come back, so
a planned restart isn't announced as a crash. An outage has to be seen twice (about a minute) before it's called offline.

Optionally pick a **status channel**: the bot renames it to "🟢 5/32 online", "🟠 restarting" or "🔴 offline". Discord limits channel renames to about two per ten minutes, so
the bot changes it at most every six minutes and keeps the latest name pending until it can (needs **Manage Channels**).

## Linking players, roles and joining the server

Players sign in on the website with Discord and link their character. A link is only a **claim** until it's proven, because anyone can type someone else's name. It is proven by:

- **An in-game code** (needs the [PalDefender](paldefender.md) integration): the player asks for a code on the website, PalOps sends it to that character in the game, and
  typing it back proves they control the character. Codes are 6 characters, valid for 10 minutes, stored only as a hash, limited to five wrong tries, and rate limited.
- **Staff approval**: the player asks staff to verify, and an admin approves it on *Players → Link requests* (or from the player's profile).

An unverified claim never earns anything and doesn't lock the character: whoever proves it takes it over from an unproven claimant. **Only verified links** are ever used for
roles, nicknames or bans.

In **Settings → Discord bot → Players and roles** you can set:

- a **verified player role**, given to players with a verified character and removed if the link is removed;
- **owner, admin and moderator roles**, given to panel users by the Discord ID on their panel account, and updated when their role changes or they're disabled;
- **nicknames** set to the verified character name;
- **Add players to the Discord server when they sign in**: the sign-in asks for the extra "join servers for you" permission, and the bot adds them (with their roles). The
  access token is used once and never stored. A refusal never blocks signing in.

The bot only touches the roles you configure, never any other. It needs **Manage Roles** with its own role above the roles it manages, **Manage Nicknames** for nicknames and
**Create Invite** for joining. **Sync roles now** brings everyone in line at once (slowly, to stay inside Discord's limits).

## Bans that follow the person

Turn on **Keep bans in step** and:

- banning a player in game (from the panel, the bot, or the IP enforcement) also bans their **verified** Discord account, and unbanning them unbans it;
- banning or unbanning someone in Discord directly does the same to their **verified** character;
- panel users are never banned on Discord as a side effect, and each side's own actions aren't echoed back (a ban followed straight away by an unban still goes through).

`/ban @member`, `/unban @member` and `/kick @member` work on a Discord member through their verified character; `/ban @member` bans them on Discord as well. It refuses to ban
yourself, the bot, or a panel user of the same or higher role than yours. Needs **Ban Members**.

## Chat relay

Pick a **chat channel** and switch the relay on:

- **Game to Discord**: chat lines are picked out of the Console's lines (the game log or PalDefender's log; see [console.md](console.md)) with a pattern, and posted as
  "**Name**: message". Palworld's REST API can't read chat, so this needs the log files or PalServerLogger set up. The default pattern assumes lines like
  `[2026-09-28 12:00:00] [CHAT] <Name> message`, which is a **guess**: paste a real chat line from the Console into the tester in the settings and adjust the pattern (it needs
  `(?<player>…)` and `(?<message>…)` groups) until it recognises it. PalDefender's chat log format isn't documented, so it needs its own pattern.
- **Discord to game**: messages in that channel appear in the game as "[Discord] Name: message", through PalDefender's chat broadcast when it's on, or the server's
  announcement otherwise (limited to 200 characters). Mentions and emoji become plain text. Bots, webhooks, other channels, floods (over five in ten seconds) and people whose
  verified character is banned are ignored. This needs **Message Content Intent** switched on in the Developer Portal (Bot page); PalOps only asks for it while this
  direction is on.

Relayed messages carry a prefix and are remembered for a minute, so the game logging them can't bounce them back to Discord. Nothing posted can ping anyone.

## Notifications

Pick an **events channel** and choose what goes there: bans, unbans and kicks (from the panel, the bot or PalDefender's IP enforcement), cheat signals, the
server going offline or coming back (it has to be down for a minute before it's announced, so a blip stays quiet), and optionally joins and leaves.

Pick a **log channel** to forward warning or error lines (or everything) from the game's and PalDefender's logs, which needs the [Console](console.md) set up.
Lines are batched into one message at a time, at most about one message every 1.5 seconds per channel, in a code block. Messages never ping anyone, and names are
escaped so they can't format or mention.

## Set it up

1. In the [Developer Portal](https://discord.com/developers/applications), open your application. The one you use for sign-in works. Copy its **Application ID**
   and **Public Key**.
2. Under **Bot**, reset the token and copy it. Switch on **Message Content Intent** only if you use the chat relay's Discord-to-game direction.
3. Add the bot to your server: **OAuth2 → URL Generator**, scopes `bot` and `applications.commands`, bot permissions **View Channels**, **Send Messages** and **Read Message History**,
   plus only what your features need: **Manage Roles**, **Manage Nicknames**, **Ban Members**, **Manage Channels**, **Create Invite**. Open the link and add it to your server.
4. In Discord, turn on Developer Mode (Settings → Advanced), then right-click your server and channels → **Copy ID**.
5. In PalOps, open **Settings → Discord bot**. Enter the application ID, public key, bot token, server ID and channel IDs, and **Save**. Do this *before* the next step.
6. Optional: in the Developer Portal, set **Interactions Endpoint URL** to the URL shown in PalOps (Discord tests it immediately). Skip this to receive commands over the live connection instead.
7. Press **Register slash commands**, then **Test** (which checks the token, the server and each channel) and **Send test message**.
8. Switch **Use the Discord bot** on if it isn't already, and save.

The bot token is encrypted at rest and never sent back to the browser. Setting changes are audited without it.

## Things to check on your server

I couldn't test against a real Discord or a real Palworld server, so please check these:

- **In-game codes** are sent as a PalDefender `PlayerChat` message. Confirm the player actually sees it (the other send types are chat variants and log lines).
- The **default chat pattern** is a guess at Palworld's log format; use the tester with real lines.
- **Role hierarchy and permissions**: the bot's role must sit above the roles it manages, and each feature needs its permission. The Test button and the settings page show
  what Discord refuses.

## Not built yet

- Buttons and confirmation prompts on destructive commands.
- A `/link` command for staff to link a Discord user to a character directly.
- Relay of messages from more than one channel.
