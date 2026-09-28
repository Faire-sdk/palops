# Builds the panel and public website into one small image.
FROM node:22-bookworm-slim AS build
# Toolchain for better-sqlite3 in case no prebuilt binary matches this Node version.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATABASE_PATH=/data/panel.db \
    WEB_DIST_PATH=/app/web/dist
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/package.json ./server/
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist
# SQLite lives on a volume mounted at /data. Railway mounts volumes as root,
# so the process runs as root inside the container.
VOLUME /data
EXPOSE 8080
WORKDIR /app/server
CMD ["node", "dist/index.js"]
