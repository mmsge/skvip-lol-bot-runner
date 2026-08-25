FROM node:22-alpine
WORKDIR /app
# Zero runtime dependencies on purpose (plan §4): node 22 ships fetch and
# node:test, and a service with no dependency tree never needs a security bump.
# There is no `npm install` step because there is nothing to install.
COPY package.json server.js logg.js robots.txt ./
COPY lib ./lib
COPY bots ./bots
COPY bin ./bin
# Git-derived site dates, written by scripts/generate-page-dates.sh (run by
# `make deploy`/`make verify` — the image has no .git). The trailing glob makes
# the COPY a no-op when the file is absent, so a bare `docker build` still
# works; the app then falls back to boot time.
COPY page-dates.jso[n] ./
# The seen-store lives here, on a named volume. Created up front so the app
# never has to mkdir a mount point it may not own.
RUN mkdir -p /app/data
EXPOSE 8080
CMD ["node", "server.js"]
