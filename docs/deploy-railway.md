# Deploying on Railway

PalOps runs as one service: the public server website at `/`, the staff panel at `/panel` and the API under `/api`.
It stores everything in SQLite on a Railway volume, so there is no separate database service.
A small server fits in Railway's Hobby plan.

> **Prefer the same machine as your Palworld server when you can.** That's the best choice for all the features;
> on Railway the panel only has the REST API, so planned features like start/restart, logs, backups and guilds won't work.
> See [deployment.md](deployment.md) for the comparison and [deploy-same-host.md](deploy-same-host.md) for that setup.

> **This guide is for PalOps only, not the Palworld server.** Railway has no inbound UDP, so players couldn't connect to a game server hosted there.
> To host the game server too, see [deploy-vps.md](deploy-vps.md).

## 1. Create the service

1. In Railway, click **New Project → Deploy from GitHub repo** and pick this repository.
   Railway finds `railway.json` and builds the `Dockerfile`, then health-checks `/api/health`.
2. Add a **volume** to the service and set its mount path to **`/data`**.
   The database lives at `/data/panel.db`. Without a volume, every redeploy starts from an empty database.
3. Under **Settings → Networking**, click **Generate Domain** (or add your own domain, e.g. `lambland.gg`).
   Use this address below as `https://<domain>`.

Keep the service at **one replica**. SQLite and the sign-in rate limiter live in that one process.

## 2. Set the variables

On the service's **Variables** tab:

| Variable | Value |
| --- | --- |
| `PANEL_SECRET` | Output of `openssl rand -hex 32`. **Keep it forever**: it encrypts the saved Palworld admin password. |
| `TRUST_PROXY` | `true` (Railway sits in front of the app) |
| `COOKIE_SECURE` | `true` |
| `DISCORD_CLIENT_ID` | From your Discord application, **OAuth2** page |
| `DISCORD_CLIENT_SECRET` | Same page |
| `DISCORD_REDIRECT_URI` | `https://<domain>/api/v1/auth/discord/callback` |
| `PANEL_SETUP_TOKEN` | Optional. Any long random string, used once to create the owner. If unset, a token is printed in the deploy logs. |
| `SITE_JOIN_ADDRESS` | Optional. What players type in Palworld, e.g. `play.lambland.gg:8211` |
| `SITE_DISCORD_INVITE` | Optional. Your community Discord invite link |
| `SITE_SHOW_ONLINE_PLAYERS` | Optional. `false` hides the online player list on the website |
| `WORLD_POLL_SECONDS` | Optional. Seconds between world snapshots (default 20, `0` turns them off) |
| `AUTH_PASSWORD_LOGIN` | Optional. `true` keeps username/password sign-in for staff as a fallback |
| `PANEL_EMERGENCY_PASSWORD` | Optional, 16+ characters. Owner sign-in for when Discord sign-in is broken ([details](../README.md#signing-in)) |

`NODE_ENV`, `PORT`, `HOST` and `DATABASE_PATH` are already set by the Dockerfile. Railway's own `PORT` also works.

## 3. Register the redirect in Discord

In the [Discord Developer Portal](https://discord.com/developers/applications), open your application, go to **OAuth2 → Redirects**
and add exactly `https://<domain>/api/v1/auth/discord/callback`. It must match `DISCORD_REDIRECT_URI` character for character:
`https`, no port, no trailing slash. Keep the `localhost` redirect as well if you also run the panel locally.

Staff and players use the same Discord application and the same redirect.

## 4. First sign-in

1. Redeploy after setting the variables. Open **Deployments → View logs** and copy the setup token
   (or use the `PANEL_SETUP_TOKEN` you set).
2. Open `https://<domain>/panel`, paste the token and click **Continue with Discord**. You're now the owner.
3. Go to **Settings → Server connection** and enter your Palworld server's REST API details.
4. Add your staff under **Settings → Users** by Discord user ID.

The public website at `https://<domain>/` is live as soon as the server connection works.

## Reaching your Palworld server from Railway

The panel talks to the Palworld REST API (default port `8212`), which authenticates only with the admin password.
Railway runs in the cloud, so that port has to be reachable from Railway, and it must not be open to everyone.

- **Best:** put both on a private network with Tailscale or another tunnel (WireGuard, Cloudflare Tunnel), and point the panel at the private address.
- **Or:** if your Railway plan offers **static outbound IPs**, enable them for the service and allow only those IPs to reach port `8212` in your game host's firewall.
- Don't expose `8212` to the whole internet.

## Troubleshooting

**Signing in lands on `localhost`.** `DISCORD_REDIRECT_URI` on Railway still points at a local address,
or the Discord portal is missing the `https://<domain>/...` redirect. Fix both, redeploy, and sign in again.

**"Invalid state" after Discord.** The sign-in was started on a different address than the one in `DISCORD_REDIRECT_URI`
(for example the `*.up.railway.app` domain versus your custom domain). Always open the site on the same domain the redirect uses.

**Everything reset after a deploy.** The volume isn't mounted at `/data`.

**The panel says the server is offline.** Railway can't reach the REST API port. See the section on reaching your Palworld server above.
