# syntax=docker/dockerfile:1
# One image definition for every service. Build from the repository root, because the
# services share the root lockfile and the @notepad/shared workspace:
#   docker build --build-arg SERVICE=auth-service -t notepad/auth-service .
# Targets: runtime (default), migrate (runs `prisma migrate deploy`; database services only).

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
WORKDIR /app
# npm ci needs every workspace's package.json to match the lockfile
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY services/api-gateway/package.json services/api-gateway/
COPY services/auth-service/package.json services/auth-service/
COPY services/notes-service/package.json services/notes-service/

# Full install, then compile shared and the service (database services also generate their Prisma client)
FROM base AS build
ARG SERVICE
RUN test -n "$SERVICE" || (echo "Pass --build-arg SERVICE=<api-gateway|auth-service|notes-service>" && exit 1)
# Prisma's schema engine (used by the migrate target) needs OpenSSL. Install it before npm ci so
# Prisma downloads the matching engine build. The runtime image doesn't need it: the pg driver
# adapter is plain JavaScript.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
RUN --mount=type=cache,target=/root/.npm npm ci
COPY tsconfig.base.json ./
COPY shared shared
COPY services/${SERVICE} services/${SERVICE}
RUN npm run build -w @notepad/shared && npm run build -w ${SERVICE}

# One-off job that applies pending migrations; needs the Prisma CLI, a dev dependency
FROM build AS migrate
ARG SERVICE
WORKDIR /app/services/${SERVICE}
USER node
CMD ["npx", "--no-install", "prisma", "migrate", "deploy"]

# Production dependencies and compiled output only
FROM base AS runtime
ARG SERVICE
ENV NODE_ENV=production
# @prisma/client lists the Prisma CLI (and through it TypeScript and Studio) as an optional peer,
# so the lockfile marks them devOptional; npm drops those only when dev AND optional are omitted.
# The one optional production package, pg-cloudflare, is only used on Cloudflare Workers.
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --omit=optional -w ${SERVICE}
COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/services/${SERVICE}/dist services/${SERVICE}/dist
WORKDIR /app/services/${SERVICE}
USER node
# node runs as PID 1 and handles SIGTERM itself (graceful shutdown in startServer)
CMD ["node", "dist/index.js"]
