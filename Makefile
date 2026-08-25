# Standard service targets for the naustet box. Slug is this service's dir name.
SERVER ?= msge
SLUG   ?= mastobots

deploy:            ## Pull, rebuild, restart (run on the server in /srv/$(SLUG))
	git pull --ff-only
	./scripts/generate-page-dates.sh || echo "WARN: page dates not regenerated — pages will stamp boot time"
	docker compose up -d --build

logs:              ## Follow container logs
	docker compose logs -f --tail=100

status:            ## Show container status
	docker compose ps

test:              ## Run the unit tests (no network, fixtures only)
	node --test test/

verify:            ## Build + boot + hit /healthz (local smoke test)
	./scripts/generate-page-dates.sh || echo "WARN: page dates not regenerated — pages will stamp boot time"
	docker compose up -d --build
	@sleep 3
	@curl -fsS http://172.18.0.1:4010/healthz && echo "  OK" || (echo "  FAILED"; exit 1)

dryrun:            ## Compose every postable article to ./dryrun/dryrun.txt — posts NOTHING
	@mkdir -p dryrun
	docker compose run --rm --no-deps -v "$$(pwd)/dryrun:/out" mastobots \
	  node bin/dryrun.js --out /out/dryrun.txt
	@echo "--- read it with: cat dryrun/dryrun.txt"

# The output is bind-mounted to the host rather than printed, because the
# composed posts are headings, intros and URLs, and `logg` collects every
# container's stdout — `docker compose run` containers included. See ADR 0008.

remote-deploy:     ## Deploy from a laptop over SSH
	ssh $(SERVER) 'cd /srv/$(SLUG) && make deploy'

.PHONY: deploy logs status test verify dryrun remote-deploy
