# syntax=docker/dockerfile:1.7
# One Dockerfile, four images (ADR 0024). Build one at a time on a small machine:
#   docker build --target api     -t lummi-api     .
#   docker build --target admin   -t lummi-admin   .
#   docker build --target web     -t lummi-web     --build-arg VITE_BOT_LINK=https://t.me/<bot> .
#   docker build --target userbot -t lummi-userbot .
ARG NODE_IMAGE=node:24-slim
ARG CADDY_IMAGE=caddy:2.10-alpine

# ---- manifests: package.json files only, so `npm ci` layers cache until a dependency changes
FROM ${NODE_IMAGE} AS manifests
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
COPY apps/miniapp/package.json apps/miniapp/
COPY apps/userbot/package.json apps/userbot/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/i18n/package.json packages/i18n/
COPY packages/rich-text/package.json packages/rich-text/

# ---- api-deps: production dependencies of the API workspace only
FROM manifests AS api-deps
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev -w @lummi/api

# ---- api: HTTP (main.ts) and worker (worker.ts) are two entrypoints of this one image.
# TypeScript runs through tsx, as in development: the workspace packages export their .ts sources,
# so compiling would need a build step for each of them. The cost is ~0.5 s of start-up.
FROM ${NODE_IMAGE} AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=api-deps /app/node_modules node_modules
COPY package.json ./
COPY packages/config packages/config
COPY packages/contracts packages/contracts
COPY packages/db packages/db
COPY packages/i18n packages/i18n
COPY packages/rich-text packages/rich-text
COPY apps/api/package.json apps/api/tsconfig.json apps/api/
COPY apps/api/src apps/api/src
# The seed workbook (the guide in the import template) that `seed:catalog` loads through the import.
COPY apps/api/seed apps/api/seed
# The bottle photos: `seed:catalog` renders them.
COPY materials/flakons materials/flakons
# Receipts and public photos live on this volume (FILES_DIR); the node user must own it.
RUN mkdir -p /data/files/public /data/files/private && chown -R node:node /data
ENV FILES_DIR=/data/files API_HOST=0.0.0.0 API_PORT=4000
USER node
WORKDIR /app/apps/api
EXPOSE 4000
CMD ["node", "--import", "tsx", "src/main.ts"]

# ---- userbot-deps: production dependencies of the userbot workspace only
FROM manifests AS userbot-deps
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev -w @lummi/userbot

# ---- userbot: the Humo userbot (ADR 0014), its own image so the personal session never shares a
# process or an image with the API. No database client, no access to the files volume. The sealed
# session lives on the `userbot-data` volume at /data/userbot (owner-only).
FROM ${NODE_IMAGE} AS userbot
ENV NODE_ENV=production
WORKDIR /app
COPY --from=userbot-deps /app/node_modules node_modules
COPY package.json ./
COPY packages/config packages/config
COPY packages/contracts packages/contracts
COPY packages/i18n packages/i18n
COPY apps/userbot/package.json apps/userbot/tsconfig.json apps/userbot/
COPY apps/userbot/src apps/userbot/src
RUN mkdir -p /data/userbot && chown node:node /data/userbot && chmod 700 /data/userbot
ENV USERBOT_SESSION_FILE=/data/userbot/session.enc
USER node
WORKDIR /app/apps/userbot
CMD ["node", "--import", "tsx", "src/main.ts"]

# ---- build-deps: every workspace with dev dependencies, for the two front-end builds
FROM manifests AS build-deps
RUN --mount=type=cache,target=/root/.npm npm ci
COPY packages packages

# ---- admin-build: Next.js standalone output
FROM build-deps AS admin-build
# Server-side only at run time (API_URL, BOT_USERNAME are read per request), nothing is baked in.
ENV NEXT_TELEMETRY_DISABLED=1
COPY apps/admin apps/admin
RUN npm run build -w @lummi/admin

FROM ${NODE_IMAGE} AS admin
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=admin-build --chown=node:node /app/apps/admin/.next/standalone ./
COPY --from=admin-build --chown=node:node /app/apps/admin/.next/static apps/admin/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/admin/server.js"]

# ---- miniapp-build: static files. The API is reached through same-origin `/api` (Caddy), so the
# only baked value is the bot link used by share buttons.
FROM build-deps AS miniapp-build
ARG VITE_BOT_LINK=
RUN test -n "$VITE_BOT_LINK" || { echo 'VITE_BOT_LINK build arg is required (the GitHub variable STAGING_BOT_LINK)'; exit 1; }
ENV VITE_BOT_LINK=${VITE_BOT_LINK}
COPY apps/miniapp apps/miniapp
RUN npm run build -w @lummi/miniapp && npm run size -w @lummi/miniapp

# ---- web: Caddy with the Mini App build and the Caddyfile (hosts come from env)
FROM ${CADDY_IMAGE} AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=miniapp-build /app/apps/miniapp/dist /srv/miniapp
