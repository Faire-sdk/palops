# Discord bot (optional)

The bot lets your staff check and moderate the server from Discord with slash commands, and posts server events to a channel. PalOps works fully
without it, and it stays off until an owner switches it on in **Settings → Discord bot**.

## How it works

Discord sends each slash command to PalOps as a signed HTTPS request, and PalOps answers. There's no gateway connection to keep alive and no extra
software to run. The bot posts to channels through Discord's REST API. Two things follow:

- **PalOps must be reachable from the internet over HTTPS** at `https://<your panel>/api/v1/discord/interactions`. The same-host setup with Caddy does this
  already. If PalOps isn't publicly reachable, the commands can't work (notifications still can).
- Every request is checked against Discord's Ed25519 signature using your application's public key, and requests more than five minutes old are refused,
  so nobody else can call the endpoint.

## Who can do what

Each person who uses a command is matched to a **panel user by their Discord ID** (an owner sets it in Settings → Users). They can do only what that user's role
allows in the web panel:

| Command | Needs | Notes |
| --- | --- | --- |
| `/status` | `server.view` | Online or not, players, FPS, uptime |
| `/players` | `players.view` | Who is online |
| `/player <name>` | `players.view` | Level, guild, first and last seen, banned or not. No addresses. |
| `/kick <player> [reason]` | `players.kick` (moderators and up) | |
| `/ban <player> [reason] [ban_ip]` | `players.ban` (admins and up) | `ban_ip` also needs a role that can see addresses |
| `/unban <player> [reason]` | `players.ban` | |
| `/announce <message>` | `server.broadcast` | |
| `/save` | `server.control` | |

- Someone whose Discord account isn't linked can do nothing, and a disabled panel user can't either. With **Anyone in the Discord server can use /status and
  /players** switched on, `/status` and `/players` also work for everyone, and their reply is visible to the channel.
- Replies are private to whoever ran the command, except those public ones.
- `player` fields suggest known players as you type, but only to people allowed to see them.
- Actions are recorded in the audit log and the player's history under the panel user's name with "(via Discord)".
- Commands only work in the configured Discord server. Each person can run at most six commands in ten seconds.

## Notifications

Pick an **events channel** and choose what goes there: bans, unbans and kicks (from the panel, the bot or PalDefender's address enforcement), cheat signals, the
server going offline or coming back (it has to be down for a minute before it's announced, so a blip stays quiet), and optionally joins and leaves.

Pick a **log channel** to forward warning or error lines (or everything) from the game's and PalDefender's logs, which needs the [Console](console.md) set up.
Lines are batched into one message at a time, at most about one message every 1.5 seconds per channel, in a code block. Messages never ping anyone, and names are
escaped so they can't format or mention.

## Set it up

1. In the [Developer Portal](https://discord.com/developers/applications), open your application. The one you use for sign-in works. Copy its **Application ID**
   and **Public Key**.
2. Under **Bot**, reset the token and copy it. No privileged intents are needed.
3. Invite the bot: **OAuth2 → URL Generator**, scopes `bot` and `applications.commands`, bot permissions **View Channels** and **Send Messages**. Open the link and add it
   to your server.
4. In Discord, turn on Developer Mode (Settings → Advanced), then right-click your server and channels → **Copy ID**.
5. In PalOps, open **Settings → Discord bot**. Enter the application ID, public key, bot token, server ID and channel IDs, and **Save**. Do this *before* the next step.
6. In the Developer Portal, set **Interactions Endpoint URL** to the URL shown in PalOps. Discord tests it immediately.
7. Press **Register slash commands**, then **Test** (which checks the token, the server and each channel) and **Send test message**.
8. Switch **Use the Discord bot** on if it isn't already, and save.

The bot token is encrypted at rest and never sent back to the browser. Setting changes are audited without it.

## Not built yet

- Posting the server's console live into a channel as an ongoing stream (the log channel forwards warnings and errors, or everything).
- A `/link` command for people to link themselves; for now an owner adds each person's Discord ID.
- Buttons and confirmation prompts on destructive commands.
