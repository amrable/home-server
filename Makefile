SERVICES = tailscale nextcloud jellyfin immich vaultwarden

-include .env
HOMESERVER_SUBNET ?= 172.20.0.0/24

net:
	docker network rm -f homeserver 2>/dev/null || true
	docker network create --subnet=$(HOMESERVER_SUBNET) homeserver

up-all: net
	$(foreach s, $(SERVICES), docker compose --env-file .env -f services/$(s)/docker-compose.yml up -d;)

down-all:
	$(foreach s, $(SERVICES), docker compose --env-file .env -f services/$(s)/docker-compose.yml down;)

up:
	docker compose --env-file .env -f services/$(service)/docker-compose.yml up -d

down:
	docker compose --env-file .env -f services/$(service)/docker-compose.yml down

pull:
	docker compose --env-file .env -f services/$(service)/docker-compose.yml pull

update: pull up

deploy:
	git pull
	$(MAKE) up-all