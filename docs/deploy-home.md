# Hosting everything at home

You can run the whole thing on your own computer: the Palworld server, the public website, the staff panel and the Discord bot.
The bot is part of PalOps, not a separate program, and it only makes outgoing connections to Discord, so it needs nothing opened on your router.

The files are in [`deploy/home/`](../deploy/home). They work on **Linux** and on **Windows with Docker Desktop**.

## How players and staff reach your computer

| Who | How | What you set up |
| --- | --- | --- |
| Players joining the game | UDP `8211` straight to your computer | A port forward on your router (or playit.gg, below) |
| Website, panel, Discord sign-in | HTTPS through a free **Cloudflare Tunnel** | A domain on Cloudflare. No ports opened, and your home IP stays hidden |
| Discord bot | Outgoing connection to Discord | Nothing |
| PalOps → game server | Inside Docker (`palworld:8212`) | Nothing. The REST API is never published |

Cloudflare Tunnel only carries web traffic, so it can't carry the game itself. That's why the game port needs its own route.

## What you need

- A computer that stays on while people play, with **16 GB of RAM or more** for Palworld alone (32 GB is comfortable if you also use it as your PC), and 4+ CPU cores.
- A wired connection with decent upload speed. Each player needs roughly 0.5–1 Mbit/s up.
- A domain added to a free [Cloudflare](https://dash.cloudflare.com/) account, e.g. `play.example.com`. Domains cost about $10 a year.
- A [Discord application](deploy-same-host.md#3-create-the-discord-application) for sign-in (and the bot, if you want it).
- Docker:
  - **Linux:** `curl -fsSL https://get.docker.com | sh`
  - **Windows:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) with the WSL 2 backend, plus Ubuntu from the Microsoft Store (`wsl --install -d Ubuntu`).

### Windows: give WSL enough memory

Docker Desktop runs containers inside WSL 2, which by default gets half of your RAM. Create `C:\Users\<you>\.wslconfig` with:

```ini
[wsl2]
memory=20GB
```

Use about 16 GB plus 4 for everything else, staying below your total RAM. Then run `wsl --shutdown` and start Docker Desktop again.
Run all the commands below **in the Ubuntu terminal** and keep the files in your Linux home folder (e.g. `~/palops`), not under `C:\`.
Files on the Windows drive are slow inside containers, and the game server can't set their permissions.

## 1. Create the Cloudflare Tunnel

1. In the Cloudflare dashboard, open **Zero Trust → Networks → Tunnels** and click **Create a tunnel**. Choose **Cloudflared**, then name it.
2. On the install step, pick **Docker** and copy the token: the long string after `--token`. You don't run the command it shows.
3. Add a **public hostname**: your domain (e.g. `play.example.com`), type **HTTP**, URL **`palops:8080`**.

## 2. Forward the game port

In your router's settings (often `192.168.1.1` or `192.168.0.1`), forward **UDP 8211** to your computer's local IP address.
Give the computer a fixed local IP (a DHCP reservation) so the forward keeps working.
Players join at `<your public IP>:8211`. You can see your public IP at [ifconfig.me](https://ifconfig.me).

- **Your public IP changes from time to time.** Many routers have built-in dynamic DNS, or use a free service such as DuckDNS, and give players that name instead.
- **On Windows**, Docker Desktop handles the Windows Firewall for published ports. If players still can't connect, allow UDP 8211 inbound in Windows Defender Firewall.
- **Can't forward ports?** Some internet providers put you behind CGNAT, and then a port forward has no effect. Your router's WAN IP is different from ifconfig.me in that case.
  Use the [playit.gg option](#no-port-forwarding-playitgg) below instead.

## 3. Configure and start

```bash
git clone https://github.com/Faire-sdk/palops.git
cd palops/deploy/home
mkdir -p palworld && sudo chown 1000:1000 palworld
cp .env.example .env
nano .env
docker compose up -d --build
```

In `.env`, set at least `SERVER_NAME`, `ADMIN_PASSWORD` (long and random), `CLOUDFLARE_TUNNEL_TOKEN`, `PANEL_SECRET`
(`openssl rand -hex 32`, and keep a copy), the Discord values for your domain, `SITE_JOIN_ADDRESS` (e.g. `203.0.113.7:8211`) and `TZ`.

The first start downloads the game server, which takes a few minutes. Follow it with `docker compose logs -f palworld`.

## 4. Connect PalOps

1. Get the setup token: the `PANEL_SETUP_TOKEN` you set, or `docker compose logs palops | grep -i token`.
2. Open `https://<domain>/panel`, paste the token and click **Continue with Discord**. You're now the owner.
3. In **Settings → Server connection**, enter host **`palworld`**, port `8212`, user `admin` and your `ADMIN_PASSWORD`.
4. In **Server → Restarts and saves**, switch on **Restart on a schedule** (every 4 hours by default).
5. Optional: in **Settings → Console logs**, set the game log folder to `/palworld/Pal/Saved/Logs`.
6. Optional: set up the [Discord bot](discord-bot.md) in **Settings → Discord bot**. Leave *Interactions Endpoint URL* empty in the Developer Portal; commands arrive over the bot's own connection.

`http://localhost:8080` reaches PalOps from the same computer even when the tunnel is down, which helps to check it's running. Discord sign-in only works on your domain.

## No port forwarding: playit.gg

[playit.gg](https://playit.gg) gives the game a public address through an outgoing tunnel, so it works behind CGNAT. It adds a little latency.
At the time of writing, UDP tunnels may need playit's paid plan (about $30 a year). Check their pricing before you rely on it.

1. Create an account, add an agent of type **Docker**, and copy its secret key into `PLAYIT_SECRET_KEY` in `.env`.
2. Start it with `docker compose --profile playit up -d`.
3. On playit.gg, add a **UDP** tunnel with local address **`127.0.0.1`**, port **`8211`**.
4. Give players the address playit shows, and put it in `SITE_JOIN_ADDRESS`.

## Running it day to day

- **Start and stop:** `docker compose up -d` and `docker compose down` in `deploy/home`. Docker restarts everything after a reboot if Docker itself starts with the computer.
  On Windows, turn on *Start Docker Desktop when you sign in* in Docker Desktop's settings.
- **Sleep:** stop the computer from sleeping while the server should be up, or the game, website and bot all go offline.
- **Updating:** `git pull`, then `docker compose pull && docker compose up -d --build`.
- **Backups:** the world is backed up every hour to `deploy/home/palworld/backups/` and kept for 3 days. Copy that folder somewhere else regularly too, such as cloud storage or another drive.
  The same goes for `.env` and the PalOps database (see [Backups](deploy-same-host.md#backups), replacing the Compose file path with `deploy/home/docker-compose.yml`).

## Without Docker on Windows

To run `PalServer.exe` natively instead, follow the README's [Windows setup](../README.md#windows-setup).
For the website, install [`cloudflared` as a Windows service](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-remote-tunnel/)
with the same tunnel token, and set the public hostname's URL to `localhost:8080` instead of Caddy. Connect the panel to `127.0.0.1:8212`.

## Troubleshooting

**The website shows a Cloudflare error (1033 or 502).** The tunnel isn't connected, or the public hostname doesn't point at `palops:8080`. Check `docker compose logs cloudflared`.

**Players can't connect but the panel shows the server online.** The port forward is missing or points at the wrong local IP, you're behind CGNAT, or a firewall is blocking UDP 8211.
Testing from inside your own network can fail even when the forward works, because many routers don't loop back. Ask a friend outside your network to try.

**The game server keeps restarting or crashes.** It's out of memory. On Windows, raise `memory` in `.wslconfig`; otherwise lower `PLAYERS` or restart more often.
