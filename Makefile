SERVICES = ocis jellyfin immich vaultwarden

net:
	docker network create homeserver 2>/dev/null || true

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