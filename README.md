# Home Server

A self-hosted home server stack running on Docker, accessible securely over [Tailscale](https://tailscale.com/) with HTTPS via Caddy.

## Services

| Service | Description | URL |
|---|---|---|
| [Nextcloud](https://nextcloud.com/) | File storage and sync | `https://<domain>` |
| [Jellyfin](https://jellyfin.org/) | Media server | `https://<domain>:8096` |
| [Immich](https://immich.app/) | Photo and video backup | `https://<domain>:2283` |
| [Vaultwarden](https://github.com/dani-garcia/vaultwarden) | Self-hosted Bitwarden password manager | `https://<domain>:8443` |

## Architecture

All services run in Docker containers on a shared `homeserver` bridge network. Caddy acts as a reverse proxy, terminating TLS using Tailscale-provisioned certificates. Access is restricted to the Tailscale network — no ports are exposed to the public internet.

```
Tailscale network
      │
      ▼
   Caddy (443 / 8443)
      │
      ├── :443        → Nextcloud
      ├── :8096       → Jellyfin
      ├── :2283       → Immich
      └── :8443       → Vaultwarden
```

## Prerequisites

- Docker & Docker Compose
- A [Tailscale](https://tailscale.com/) account with [HTTPS enabled](https://tailscale.com/kb/1153/enabling-https/) for your tailnet
- Tailscale TLS certificates placed at `/home/<user>/` on the host

## Setup

1. **Clone the repo**
   ```bash
   git clone https://github.com/amrfahmy/home-server.git
   cd home-server
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your values
   ```

3. **Start all services**
   ```bash
   make up-all
   ```

## Configuration

All configuration lives in `.env`. Copy `.env.example` to get started:

```env
DOMAIN=your-tailscale-domain.ts.net
DATA_PATH=/mnt/data          # where persistent data is stored on the host

# Nextcloud
MYSQL_ROOT_PASSWORD=changeme
MYSQL_DATABASE=nextcloud
MYSQL_USER=nextcloud
MYSQL_PASSWORD=changeme
NEXTCLOUD_ADMIN_USER=admin
NEXTCLOUD_ADMIN_PASSWORD=changeme
NEXTCLOUD_TRUSTED_DOMAINS=your-tailscale-domain.ts.net

# Immich
IMMICH_DB_USERNAME=immich
IMMICH_DB_PASSWORD=changeme
IMMICH_DB_DATABASE=immich

# Vaultwarden
VAULTWARDEN_ADMIN_TOKEN=changeme
```

## Makefile Commands

| Command | Description |
|---|---|
| `make up-all` | Start all services |
| `make down-all` | Stop all services |
| `make up service=<name>` | Start a single service |
| `make down service=<name>` | Stop a single service |
| `make update service=<name>` | Pull latest image and restart a service |
| `make deploy` | Pull latest git changes and restart all services |

## Connecting to Vaultwarden

Vaultwarden is API-compatible with Bitwarden. Use any official [Bitwarden client](https://bitwarden.com/download/) and point it at your self-hosted server:

1. Open the Bitwarden app or browser extension
2. Click the gear icon on the login screen
3. Set **Server URL** to `https://<your-domain>:8443`
4. Log in or create an account
