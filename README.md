# Home Server

A self-hosted home server stack running on Docker, exposed securely to the internet with [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) at the edge (TLS, DDoS protection, WAF).

## Services

| Service | Description | URL |
|---|---|---|
| [Nextcloud](https://nextcloud.com/) | File storage and sync | `https://nextcloud.amrhost.de` |
| [Jellyfin](https://jellyfin.org/) | Media server | `https://jellyfin.amrhost.de` |
| [Immich](https://immich.app/) | Photo and video backup | `https://immich.amrhost.de` |
| [Vaultwarden](https://github.com/dani-garcia/vaultwarden) | Self-hosted Bitwarden password manager | `https://vaultwarden.amrhost.de` |

## Architecture

All services run in Docker containers on a shared `homeserver` bridge network. `cloudflared` runs a Cloudflare Tunnel connector on the same network and routes traffic to the services by container name. Hostnames are mapped to services in the Cloudflare Zero Trust dashboard, so nothing is exposed to the public internet — even the hostname-to-service mapping lives at Cloudflare's edge.

```
Cloudflare edge (TLS, WAF, DDoS protection)
      │
      ▼
 cloudflared (outbound tunnel, no inbound ports)
      │
      ├── nextcloud.amrhost.de  → http://nextcloud           (port 80)
      ├── jellyfin.amrhost.de   → http://jellyfin:8096
      ├── immich.amrhost.de     → http://immich-server:2283
      └── vaultwarden.amrhost.de → http://vaultwarden:80
```

## Prerequisites

- Docker & Docker Compose
- A domain on Cloudflare (DNS proxied through Cloudflare)
- A [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/) created in the Zero Trust dashboard

## Setup

1. **Clone the repo**
   ```bash
   git clone https://github.com/amrfahmy/home-server.git
   cd home-server
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   # Set DOMAIN, TUNNEL_TOKEN, and passwords
   ```

3. **Create a Cloudflare Tunnel**
   - In the Zero Trust dashboard → **Networks → Tunnels** → **Create a tunnel** → pick the **Cloudflared** connector type (Docker).
   - Copy the **Tunnel Token** into `TUNNEL_TOKEN` in `.env`.

4. **Start all services**
   ```bash
   make up-all
   ```

5. **Add public hostnames** on the tunnel in the dashboard, each pointing at the internal service:
   - `nextcloud.<your-domain>` → `http://nextcloud`
   - `jellyfin.<your-domain>` → `http://jellyfin:8096`
   - `immich.<your-domain>` → `http://immich-server:2283`
   - `vaultwarden.<your-domain>` → `http://vaultwarden:80`

## Configuration

All configuration lives in `.env`. Copy `.env.example` to get started:

```env
TUNNEL_TOKEN=your-tunnel-token

DOMAIN=example.com
NEXTCLOUD_HOST=nextcloud
JELLYFIN_HOST=jellyfin
IMMICH_HOST=immich
VAULTWARDEN_HOST=vaultwarden

# Nextcloud
MYSQL_ROOT_PASSWORD=changeme
MYSQL_DATABASE=nextcloud
MYSQL_USER=nextcloud
MYSQL_PASSWORD=changeme
NEXTCLOUD_ADMIN_USER=admin
NEXTCLOUD_ADMIN_PASSWORD=changeme

# Immich
IMMICH_DB_USERNAME=immich
IMMICH_DB_PASSWORD=changeme
IMMICH_DB_DATABASE=immich

# Vaultwarden
VAULTWARDEN_ADMIN_TOKEN=changeme

DATA_PATH=/mnt/data          # where persistent data is stored on the host
```

## Makefile Commands

| Command | Description |
|---------|-------------|
| `make up-all` | Start all services |
| `make down-all` | Stop all services |
| `make up service=<name>` | Start a single service |
| `make down service=<name>` | Stop a single service |
| `make update service=<name>` | Pull latest image and restart a service |
| `make deploy` | Pull latest git changes and restart all services |

## Connecting to Vaultwarden

Point any [Bitwarden client](https://bitwarden.com/download/) at your self-hosted server:

1. Open the Bitwarden app or browser extension
2. Click the gear icon on the login screen
3. Set **Server URL** to `https://vaultwarden.amrhost.de`
4. Log in or create an account