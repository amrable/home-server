# Home Server

A self-hosted server stack running on Docker (e.g. Hetzner), accessed privately over a [Tailscale](https://tailscale.com/) tailnet. Nothing is exposed to the public internet.

## Services

Each service runs behind its own Tailscale sidecar, reachable at a proper HTTPS URL inside the tailnet:

| Service | Description | URL (over Tailscale) |
|---|---|---|
| [OCIS](https://owncloud.com/infinite-scale/) | File storage and sync (ownCloud Infinite Scale) | `https://cloud.<tailnet-domain>` |
| [Jellyfin](https://jellyfin.org/) | Media server | `https://media.<tailnet-domain>` |
| [Immich](https://immich.app/) | Photo and video backup | `https://photos.<tailnet-domain>` |
| [Vaultwarden](https://github.com/dani-garcia/vaultwarden) | Self-hosted Bitwarden password manager | `https://vault.<tailnet-domain>` |
| [Paperless-ngx](https://docs.paperless-ngx.com/) | Document management | `https://docs.<tailnet-domain>` |
| [n8n](https://n8n.io/) | Workflow automation | `https://n8n.<tailnet-domain>` |

## Architecture

All services run in Docker containers on a shared `homeserver` bridge network. Each service is paired with a **Tailscale sidecar container** that joins the tailnet as its own machine (`cloud`, `media`, `photos`, `vault`) and runs [`tailscale serve`](https://tailscale.com/kb/1312/serve): it terminates TLS with a real Let's Encrypt cert provisioned by Tailscale and reverse-proxies to its service over the docker network. No public ports, no IPs to remember, valid HTTPS everywhere (Bitwarden clients require it).

```
Your device (Tailscale client)
      │
      ▼
┌─ tailnet (MagicDNS: <name>.<tailnet-domain>) ─────────────┐
│  cloud-ts  → serve 443 → http://ocis:9200                 │
│  media-ts  → serve 443 → http://jellyfin:8096             │
│  photos-ts → serve 443 → http://immich:2283               │
│  vault-ts  → serve 443 → http://vaultwarden:80            │
│  docs-ts   → serve 443 → http://paperless:8000            │
└───────────────────────────────────────────────────────────┘
```

## Prerequisites

- Docker & Docker Compose
- A [Tailscale](https://tailscale.com/) account with **MagicDNS** and **HTTPS Certificates** enabled (admin console → **DNS**)

## Setup

1. **Clone the repo**
   ```bash
   git clone https://github.com/amrfahmy/home-server.git
   cd home-server
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   # Set TS_AUTHKEY, TAILNET_DOMAIN, and passwords
   ```

3. **Create a Tailscale auth key**
   - In the Tailscale admin console → **Settings → Keys** → **Generate auth key**.
   - Enable **Reusable** (required — each service runs its own tailscale machine).
   - Copy the key into `TS_AUTHKEY` in `.env`.

4. **Set your tailnet domain**
   - Admin console → **DNS** → your tailnet's MagicDNS suffix (e.g. `tail80ea1b.ts.net`).
   - Copy it into `TAILNET_DOMAIN` in `.env`.

5. **Start all services**
   ```bash
   make up-all
   ```

   Each sidecar registers itself in the tailnet and requests its cert automatically. First HTTPS hit per service may take a few seconds while the cert is provisioned.

## Configuration

All configuration lives in `.env`. Copy `.env.example` to get started:

```env
TS_AUTHKEY=tskey-auth-...
TAILNET_DOMAIN=my-tailnet.ts.net

# OCIS (all other secrets are auto-generated into config/ocis.yaml by `ocis init`)
OCIS_ADMIN_PASSWORD=changeme

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

## Paperless → n8n webhook

When Paperless consumes a document it can POST a webhook into n8n, e.g. to trigger an OCR/AI/extraction workflow. Set it up once in the Paperless UI:

1. **n8n**: create a workflow with a **Webhook** trigger node (path `paperless`, e.g. `POST /webhook/paperless`). Enable the workflow.
2. **Paperless** → **Workflows** → **Add workflow**:
   - Trigger: **Document added**
   - Action: **Webhook**
   - URL: `http://n8n:5678/webhook/paperless` (docker-internal, no TLS needed)
   - Body: JSON, optionally using placeholders such as `{{ document.title }}`, `{{ document.id }}`

No extra config is required: Paperless allows internal webhook requests by default, and both containers share the `homeserver` network.

## Connecting to Vaultwarden

Point any [Bitwarden client](https://bitwarden.com/download/) at your self-hosted server, over Tailscale:

1. Open the Bitwarden app or browser extension
2. Click the gear icon on the login screen
3. Set **Server URL** to `https://vault.<your-tailnet-domain>`
4. Log in or create an account