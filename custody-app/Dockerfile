# CoParent Hub server: web portal + API for the iPhone app.
# No npm dependencies, so there is no install step: the image is Node plus the source.
FROM node:22-slim

# NPM_CONFIG_SCRIPT_SHELL=/bin/bash: bash execs the single "node ..." command, so the SIGTERM that
# `docker stop` sends to npm reaches node and the server shuts down cleanly (dash would swallow it).
# RUN_AS_USER=node: the server runs as the unprivileged "node" user (see below).
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/data/coparent.db \
    RUN_AS_USER=node \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_SCRIPT_SHELL=/bin/bash

WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
COPY scripts ./scripts

# The database lives on a volume at /app/data.
# Non-root: the server process runs as the image's unprivileged "node" user (uid 1000). The container
# starts as root only because Fly.io volumes and Render disks are mounted root-owned: before opening the
# database or binding the port, server/privileges.js gives /app/data to RUN_AS_USER and permanently drops
# to it. If your platform already provides a writable volume, `docker run --user node` (or adding
# `USER node` here) works too; the switch is then skipped.
RUN mkdir -p /app/data/backups && chown -R node:node /app/data
VOLUME ["/app/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["npm", "start"]
