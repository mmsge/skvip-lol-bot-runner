FROM node:22-alpine
WORKDIR /app
# Dependency-free starter: swap in your own package.json + build as the app grows.
COPY server.js ./
# Git-derived site dates, written by scripts/generate-page-dates.sh (run by
# `make deploy`/`make verify` — the image has no .git). The trailing glob makes
# the COPY a no-op when the file is absent, so a bare `docker build` still
# works; the app then falls back to boot time.
COPY page-dates.jso[n] ./
EXPOSE 8080
CMD ["node", "server.js"]
