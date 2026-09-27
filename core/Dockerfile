FROM node:20-slim

WORKDIR /app
COPY core/package.json ./
COPY core/server.mjs ./

# server.mjs writes state to ./data/pandora.json (relative to cwd, i.e. /app).
# This path is mounted as a Docker volume (see docker-compose.yml) so the
# associative network and memories survive restarts/updates.
RUN mkdir -p /app/data

EXPOSE 8787
CMD ["node", "server.mjs"]
