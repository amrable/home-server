SERVICES = nextcloud jellyfin immich vaultwarden caddy

up-all:
	docker network create homeserver || true
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