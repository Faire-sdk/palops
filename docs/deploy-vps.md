# Hosting Palworld and PalOps on one VPS

This guide rents one cheap Linux VPS and runs everything on it: the Palworld dedicated server, PalOps and Caddy for HTTPS.
It's the [same-machine setup](deploy-same-host.md) with the game server included, so every PalOps feature works.
The files are in [`deploy/vps/`](../deploy/vps).

## Why not Railway?

Railway can host PalOps, but it can't host the game server itself. Palworld players connect over **UDP** (port `8211`),
and Railway only accepts HTTP and TCP from the internet. Its TCP Proxy doesn't carry UDP, and Railway staff have confirmed
inbound UDP isn't supported ([feedback thread](https://station.railway.com/feedback/allow-outbound-udp-traffic-0f74101c),
[newer request](https://station.railway.com/feedback/udp-inboud-connections-9f036ffc), still under review in October 2026).
A UDP tunnel service could work around this, but it adds lag and another moving part. Railway also bills RAM at $10 per GB a month,
so a 16 GB game server would cost far more there than on a VPS.

## Picking a VPS

Pocketpair asks for **16 GB of RAM** and 4 or more CPU cores. 8 GB boots, but a long-running world can run out of memory and crash.
Any VPS with full root access works, because you can open any port, including UDP. Prices as of October 2026:

| Provider and plan | vCPU | RAM | Price per month | Notes |
| --- | --- | --- | --- | --- |
| **Hetzner Cloud CX43** (recommended) | 8 shared | 16 GB | about €16 | Germany or Finland only. 20 TB of traffic, hourly billing, reliable |
| Hetzner Cloud CAX31 | 8 Arm | 16 GB | about €21 | Arm CPU: the game runs through the Box64 emulator, so it's slower. Pick x86 when you can |
| Contabo Cloud VPS (16 GB) | 6 | 16 GB | about $11–14 | Cheapest, but CPU is heavily shared, so performance varies more |
| Netcup VPS (16 GB) | 8 | 16 GB | about €17 | Germany and Austria, usually billed by the year |
| OVHcloud VPS-4 | 8 | 24 GB | about $28 | Has North American locations |

Choose a location close to your players: Hetzner CX plans are only in Europe, so for players in North America pick OVHcloud
or another provider with servers there. Use **Ubuntu 24.04** or **Debian 12**, and add an SSH key when you create the server.

## 1. Prepare the server

Log in as root, then install Docker and set up the firewall:

```bash
curl -fsSL https://get.docker.com | sh

ufw allow 22/tcp       # SSH, before enabling the firewall
ufw allow 8211/udp     # Palworld game port
ufw allow 80/tcp       # Caddy, for the HTTPS certificate
ufw allow 443/tcp      # website and panel
ufw enable             # everything else, including 8212 (REST API), stays closed
```

Only open `27015/udp` if you set `COMMUNITY=true` to list the server in the in-game browser.
If your provider has its own cloud firewall (Hetzner does), apply the same rules there.

Point a domain's DNS `A` record (e.g. `play.example.com`) at the server's IP.

## 2. Create the Discord application

Follow [step 3 of the same-host guide](deploy-same-host.md#3-create-the-discord-application).

## 3. Configure and start

```bash
git clone https://github.com/Faire-sdk/palops.git
cd palops/deploy/vps
mkdir -p palworld && chown 1000:1000 palworld
cp .env.example .env
nano .env
docker compose up -d --build
```

In `.env`, set at least `SERVER_NAME`, `ADMIN_PASSWORD` (long and random), `PALOPS_DOMAIN`, `PANEL_SECRET`
(`openssl rand -hex 32`, and keep a copy) and the Discord values. Set `SITE_JOIN_ADDRESS` to your domain or IP with `:8211`.

The first start downloads the Palworld server through SteamCMD, which takes a few minutes. Watch it with
`docker compose logs -f palworld`. Once the download finishes and the server has started, players can join at `<your IP or domain>:8211`.

## 4. Connect PalOps

1. Get the setup token: the `PANEL_SETUP_TOKEN` you set, or `docker compose logs palops | grep -i token`.
2. Open `https://<domain>/panel`, paste the token and click **Continue with Discord**. You're now the owner.
3. In **Settings → Server connection**, enter host `127.0.0.1`, port `8212`, user `admin` and your `ADMIN_PASSWORD`.
4. Optional: in **Settings → Console logs**, set the game log folder to `/palworld/Pal/Saved/Logs` (see [console.md](console.md)).

## What the Palworld container does for you

The game server runs on the community-maintained [`thijsvanloef/palworld-server-docker`](https://github.com/thijsvanloef/palworld-server-docker) image.
This Compose file configures it to:

- update the server on every start (`UPDATE_ON_BOOT`),
- back up the world every 6 hours to `deploy/vps/palworld/backups/` and delete backups older than 7 days,
- restart once a day at 06:00 (in `TZ`), with an in-game warning 5 minutes before, because Palworld's memory use grows the longer it runs.

Change these in `.env`. The image's other settings are listed in its README and can be added to the `palworld` service's `environment`.
Game settings that the image builds from environment variables overwrite `PalWorldSettings.ini` on each start, so set them there, not in the file.

## Backups

The world saves and the image's backups live in `deploy/vps/palworld/` on the VPS. Backups on the same machine won't help if the VPS itself is lost.
Copy `palworld/backups/`, the PalOps database (see [Backups in the same-host guide](deploy-same-host.md#backups)) and `.env`
somewhere else regularly. Many providers also sell full-server snapshots for a small fee.

## Updating

```bash
cd palops && git pull
cd deploy/vps && docker compose pull && docker compose up -d --build
```

Restarting the `palworld` service also updates the game server.

## Troubleshooting

**Players can't connect.** Check that `8211/udp` is open in both `ufw` and the provider's firewall, and that `docker compose logs palworld` shows the server running.

**The server crashes or restarts on its own.** It's probably out of memory. Check with `free -h` and `docker stats`. Lower `PLAYERS`, restart more often, or move to a plan with more RAM.

For Caddy, sign-in and port conflicts, see [Troubleshooting in the same-host guide](deploy-same-host.md#troubleshooting).
