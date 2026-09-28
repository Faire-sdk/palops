# Deploying next to your Palworld server

This is the recommended setup: PalOps runs on the same Linux machine as the Palworld dedicated server.
The panel reaches the REST API on `127.0.0.1`, so that port stays closed to the internet,
and every current and planned feature works. See [deployment.md](deployment.md) for how this compares with other hosts.

You'll end up with:

- `https://<domain>/` for the public server website, and `https://<domain>/panel` for staff.
- Caddy in front, with a free HTTPS certificate it renews on its own.
- The PalOps database in a Docker volume, backed up off the machine.

## What you need

- The machine that runs your Palworld server, with shell access, Docker and the Compose plugin.
  The files in [`deploy/same-host/`](../deploy/same-host) use host networking, which works on Linux. For a Windows server, see [Windows server](#windows-server).
- A domain (or subdomain) whose DNS `A` record points at the machine, e.g. `play.example.com`.
- A Discord application for sign-in (step 3).

## 1. Turn on the Palworld REST API

In `PalWorldSettings.ini` (usually `Pal/Saved/Config/LinuxServer/PalWorldSettings.ini`), set:

```ini
RESTAPIEnabled=True,RESTAPIPort=8212,AdminPassword="<a long password>"
```

Restart the Palworld server. From the machine, `curl -u admin:<password> http://127.0.0.1:8212/v1/api/info` should return JSON.

## 2. Close the REST API port, open the web ports

Only the game port and the web ports should be reachable from outside. With `ufw`:

```bash
sudo ufw allow 22/tcp        # SSH, before enabling the firewall
sudo ufw allow 8211/udp      # Palworld game port
sudo ufw allow 80/tcp        # Caddy, for the HTTPS certificate
sudo ufw allow 443/tcp       # the website and panel
sudo ufw deny 8212           # REST API: local only
sudo ufw enable
```

If your host has its own firewall (cloud security groups, a hosting control panel), apply the same rules there.
Docker can publish ports around `ufw`, but this setup publishes none: both containers use the host network.

## 3. Create the Discord application

1. In the [Discord Developer Portal](https://discord.com/developers/applications), create an application.
2. On **OAuth2**, copy the **Client ID** and **Client Secret**.
3. Add the redirect `https://<domain>/api/v1/auth/discord/callback`.

## 4. Configure and start

```bash
git clone https://github.com/Faire-sdk/palops.git
cd palops/deploy/same-host
cp .env.example .env
nano .env        # fill in the domain, PANEL_SECRET, the Discord values and the site details
docker compose up -d --build
```

Generate `PANEL_SECRET` with `openssl rand -hex 32` and keep a copy somewhere safe: it encrypts the saved Palworld admin password.

The Compose file sets `HOST=127.0.0.1`, `TRUST_PROXY=true` and `COOKIE_SECURE=true` for you,
so the app only listens locally and Caddy is the only way in.

## 5. First sign-in

1. Get the setup token: the `PANEL_SETUP_TOKEN` you set, or `docker compose logs palops | grep -i token`.
2. Open `https://<domain>/panel`, paste the token and click **Continue with Discord**. You're now the owner.
3. Go to **Settings → Server connection** and enter host `127.0.0.1`, port `8212`, user `admin` and your admin password (details in the [README](../README.md#connecting-to-palworld)).
4. Add staff under **Settings → Users** by Discord user ID.

The public website at `https://<domain>/` is live once the connection test passes.

## If Palworld runs in Docker too

Many servers use a Palworld container (for example `thijsvanloef/palworld-server-docker`). Two ways to connect:

- **Publish the REST API on localhost only.** In the Palworld service, map it as `"127.0.0.1:8212:8212"`,
  and keep the panel on host `127.0.0.1`, port `8212` as above.
- **Share a Docker network.** Drop `network_mode: host` from the `palops` service, put it on the Palworld container's network,
  and use `http://<palworld service name>:8212`. Then publish `127.0.0.1:8080:8080` for the panel so Caddy can still reach it.

Either way, never publish `8212` on `0.0.0.0`.

## Backups

The PalOps database is small. Copy it off the machine regularly, for example with a nightly cron job:

```bash
docker compose -f /path/to/palops/deploy/same-host/docker-compose.yml exec -T palops \
  node -e "require('better-sqlite3')('/data/panel.db').backup('/data/panel-backup.db').then(()=>{})"
docker cp "$(docker compose -f /path/to/palops/deploy/same-host/docker-compose.yml ps -q palops)":/data/panel-backup.db ./panel-$(date +%F).db
```

Send the copies somewhere other than this machine (object storage, another server), along with your Palworld save folder.
Keep a copy of `.env` too; without the same `PANEL_SECRET`, the saved Palworld password can't be decrypted and has to be re-entered.

## Updating

```bash
cd palops && git pull
cd deploy/same-host && docker compose up -d --build
```

Database migrations run automatically on start.

## No open web ports: Cloudflare Tunnel

If you'd rather not open 80 and 443 on the game machine, run `cloudflared` on it instead of Caddy
and point the tunnel's public hostname at `http://127.0.0.1:8080`. Remove the `caddy` service from the Compose file
and close 80 and 443. Everything else stays the same, including `DISCORD_REDIRECT_URI` on your tunnel's domain.

## Windows server

The Compose files above are for Linux. If your Palworld server runs on Windows, run PalOps directly with Node on the same PC:

1. Install [Node.js 22 LTS](https://nodejs.org/) and [Git](https://git-scm.com/download/win).
2. In PowerShell:

   ```powershell
   git clone https://github.com/Faire-sdk/palops.git
   cd palops
   npm ci
   npm run build
   copy .env.example server\.env
   notepad server\.env
   ```

3. In `server\.env` set `NODE_ENV=production`, `HOST=127.0.0.1`, `PORT=8080`, `TRUST_PROXY=true`, `COOKIE_SECURE=true`,
   a `PANEL_SECRET` (any 64 random hex characters; keep it) and the Discord values for your domain.
4. Start it with `npm start` from the `palops` folder. To keep it running after sign-out, register it as a service
   with a tool such as [NSSM](https://nssm.cc/) or [Servy](https://github.com/aelassas/servy), with `palops\server` as the working directory and `node dist\index.js` as the command.
5. For HTTPS, install [Caddy for Windows](https://caddyserver.com/download) and run it with a `Caddyfile` containing:

   ```text
   play.example.com {
   	reverse_proxy 127.0.0.1:8080
   }
   ```

   Allow inbound TCP 80 and 443 in Windows Firewall for Caddy.
6. In the panel, connect to host `127.0.0.1`, port `8212` (see the [README](../README.md#connecting-to-palworld)).

Back up `server\data\panel.db` and `server\.env` somewhere off the machine, along with the Palworld save folder
(`Pal\Saved\SaveGames`).

## Troubleshooting

**Caddy can't get a certificate.** The domain's DNS doesn't point at this machine yet, or port 80 or 443 is blocked. Check with `docker compose logs caddy`.

**The panel says the server is offline.** The REST API isn't enabled or Palworld hasn't restarted since you enabled it. Run the `curl` from step 1 on the machine.

**Signing in loops back or says "invalid state".** Open the site on exactly the domain in `DISCORD_REDIRECT_URI`, over `https`.

**`address already in use` on 80, 443 or 8080.** Another web server (nginx, Apache) is already running on the machine.
Stop it, or keep it and point it at `127.0.0.1:8080` instead of running Caddy.
