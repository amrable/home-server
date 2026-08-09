# Home Server

A self-hosted server stack running on Docker (e.g. Hetzner), accessed privately over a [Tailscale](https://tailscale.com/) VPN. Nothing is exposed to the public internet.

## Services

| Service | Description | URL (over Tailscale) |
|---|---|---|
| [Nextcloud](https://nextcloud.com/) | File storage and sync | `http://172.20.0.11` |
| [Jellyfin](https://jellyfin.org/) | Media server | `http://172.20.0.12:8096` |
| [Immich](https://immich.app/) | Photo and video backup | `http://172.20.0.13:2283` |
| [Vaultwarden](https://github.com/dani-garcia/vaultwarden) | Self-hosted Bitwarden password manager | `http://172.20.0.14` |

## Architecture

All services run in Docker containers on a shared `homeserver` bridge network (`172.20.0.0/24`) with fixed per-service IPs. A `tailscale` container runs on the same host as a **subnet router**, advertising that subnet to your tailnet, so your phone/laptop can reach the services directly over the encrypted WireGuard mesh — no public ports, no TLS-terminating proxy in front.

```
Your device (Tailscale client)
      │
      ▼
 tailscale subnet router (advertises 172.20.0.0/24)
      │
      ├── http://172.20.0.11       → Nextcloud
      ├── http://172.20.0.12:8096  → Jellyfin
      ├── http://172.20.0.13:2283  → Immich
      └── http://172.20.0.14       → Vaultwarden
```

## Prerequisites

- Docker & Docker Compose
- A [Tailscale](https://tailscale.com/) account

## Setup

1. **Clone the repo**
   ```bash
   git clone https://github.com/amrfahmy/home-server.git
   cd home-server
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   # Set TS_AUTHKEY and passwords
   ```

3. **Create a Tailscale auth key**
   - In the Tailscale admin console → **Settings → Keys** → **Generate auth key**.
   - Enable **Subnet routes** on the key (required so the container can advertise `172.20.0.0/24`).
   - Copy the key into `TS_AUTHKEY` in `.env`.

4. **Start all services**
   ```bash
   make up-all
   ```

5. **Approve the subnet route**
   - In the Tailscale admin console → **Machines → home → Edit route settings**
   - Enable (approve) the advertised `172.20.0.0/24` route.

## Configuration

All configuration lives in `.env`. Copy `.env.example` to get started:

```env
TS_AUTHKEY=tskey-auth-...

HOMESERVER_SUBNET=172.20.0.0/24

NEXTCLOUD_IP=172.20.0.11
JELLYFIN_IP=172.20.0.12
IMMICH_IP=172.20.0.13
VAULTWARDEN_IP=172.20.0.14

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

Point any [Bitwarden client](https://bitwarden.com/download/) at your self-hosted server, over Tailscale:

1. Open the Bitwarden app or browser extension
2. Click the gear icon on the login screen
3. Set **Server URL** to `http://172.20.0.14` (replace with your `VAULTWARDEN_IP`)
4. Log in or create an account

> Bitwarden clients accept `http://` URLs when connecting to a private IP. If your client insists on HTTPS, you can reach Vaultwarden through Tailscale's HTTPS feature instead.