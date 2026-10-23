# Notepad API

A note-taking backend built on a microservices architecture with **Node.js**, **TypeScript**, **Express** and **PostgreSQL**.

Each service owns its own database and is deployed independently. Services trust each other through signed JWT access tokens issued by the auth service.

> **Status:** early development. The **API gateway**, **auth-service** and **notes-service** work end-to-end. The user service is not built yet. See [Project status](#project-status) and [Roadmap](#roadmap).

---

## Table of contents

- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Repository structure](#repository-structure)
- [Project status](#project-status)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [API reference](#api-reference)
- [Authentication design](#authentication-design)
- [Database schema](#database-schema)
- [API gateway](#api-gateway)
- [Shared package](#shared-package)
- [Available scripts](#available-scripts)
- [Testing](#testing)
- [Roadmap](#roadmap)
- [Known limitations](#known-limitations)

---

## Architecture

```
                    ┌─────────────────────────┐
   Client ────────▶ │ ✅ api-gateway  :3000    │  routing, rate limiting, CORS,
   /api/v1/...      │   (only public entry)   │  security headers, request ids
                    └────────────┬────────────┘
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
     ┌────────────────┐   ┌──────────────┐   ┌────────────────┐
     │  auth-service  │   │ user-service │   │ notes-service  │
     │ ✅ :3001 (int.) │   │  (planned)   │   │ ✅ :3002 (int.) │
     └───────┬────────┘   └──────┬───────┘   └───────┬────────┘
             ▼                   ▼                   ▼
       ┌──────────┐        ┌──────────┐        ┌──────────┐
       │ Postgres │        │ Postgres │        │ Postgres │
       │  (auth)  │        │  (user)  │        │ (notes)  │
       └──────────┘        └──────────┘        └──────────┘
```

- **One public entry point.** Clients only talk to the gateway. Services are internal and can be bound to private interfaces.
- **Database per service.** No service reads another service's tables.
- **Stateless auth between services.** The auth-service issues short-lived JWT access tokens. Other services verify them locally with the shared secret, so no call to the auth-service is needed per request. The gateway doesn't verify tokens and never holds the secret.
- **Shared package.** Common types, HTTP helpers and JWT verification live in [`@notepad/shared`](#shared-package), so every service handles errors and checks tokens the same way.

---

## Tech stack

| Concern | Choice |
|---|---|
| Runtime | Node.js 22+ |
| Language | TypeScript 6 (strict mode) |
| HTTP framework | Express 5 (async errors handled natively) |
| Database | PostgreSQL |
| ORM | Prisma 7 with `@prisma/adapter-pg` driver adapter |
| Validation | Joi (request bodies and environment variables) |
| Password hashing | Node.js built-in `crypto.scrypt` (no native dependencies) |
| Tokens | `jsonwebtoken` (HS256) + opaque refresh tokens |
| Gateway | `http-proxy-middleware` (streaming proxy), `express-rate-limit`, `helmet`, `cors`, `pino` / `pino-http` (JSON logs) |
| Monorepo | npm workspaces (single root lockfile) |
| Dev runner | `tsx watch` + `tsc --watch`, run together with `concurrently` |

---

## Repository structure

```
notepad-api/
├── README.md
├── package.json                     # Workspace root: workspaces + build/dev scripts
├── package-lock.json                # Single lockfile for all packages
├── tsconfig.base.json               # Compiler options every package extends
├── eslint.config.mjs                # ESLint flat config (typescript-eslint, Prettier-compatible)
├── .prettierrc.json                 # Prettier options; .prettierignore excludes generated code and Markdown
├── .editorconfig                    # Editor defaults matching Prettier
├── jest.config.mjs                  # One Jest project per package, plus integration projects
├── Dockerfile                       # One image definition for every service (--build-arg SERVICE=...)
├── docker-compose.yml               # Postgres, migration jobs, services and gateway
├── .dockerignore
├── .env.example                     # Settings for docker compose (JWT secret, host ports, CORS)
├── docker/postgres/init.sql         # Creates one database per service on first start
├── shared/                          # @notepad/shared, compiled to dist/
│   ├── src/
│   │   ├── index.ts                 # Public entry point
│   │   ├── types/                   # User, ApiResponse, AuthUser, AccessTokenPayload
│   │   ├── http/                    # AppError, ok/fail, error handlers, validation, health, startServer
│   │   └── auth/                    # verifyAccessToken, createRequireAuth, req.user typing
│   ├── tsconfig.json                # Type-checking (source and tests)
│   └── tsconfig.build.json          # Compiles src/ to dist/, excluding tests
└── services/
    ├── api-gateway/                 # ✅ Public entry point (no database)
    │   ├── src/
    │   │   ├── index.ts             # Server bootstrap
    │   │   ├── app.ts               # Middleware order and route table
    │   │   ├── config.ts            # Upstreams, CORS, trust proxy, rate limits (validated)
    │   │   ├── proxy.ts             # Streaming proxy, path rewrite, timeouts, 502/504 handling
    │   │   ├── health.ts            # Aggregated upstream health
    │   │   └── middleware/          # requestId, logger, security (helmet/CORS/body size), rateLimits
    │   ├── test/                    # Gateway tests against fake upstream servers
    │   ├── .env.example
    │   └── tsconfig.json            # Plus tsconfig.build.json, as in shared/
    ├── auth-service/                # ✅ Registration, login, token lifecycle
    │   ├── prisma/
    │   │   ├── schema.prisma        # User, RefreshToken models
    │   │   └── migrations/          # Versioned SQL migrations
    │   ├── src/
    │   │   ├── index.ts             # Server bootstrap (startServer from shared)
    │   │   ├── app.ts               # Express app, routes, error handling
    │   │   ├── config.ts            # Env var validation (fails fast)
    │   │   ├── database.ts          # Prisma client
    │   │   ├── middleware.ts        # requireAuth configured with this service's JWT settings
    │   │   ├── validation.ts        # Joi request schemas
    │   │   ├── routes/              # auth.routes.ts
    │   │   ├── services/            # auth.service.ts (business logic)
    │   │   ├── utils/               # password.ts (scrypt), tokens.ts (signing), loginThrottle.ts (per-account lockout)
    │   │   └── generated/prisma/    # Generated Prisma client (gitignored)
    │   ├── test/                    # Integration tests, env setup, test-database setup
    │   ├── .env.example
    │   ├── prisma.config.ts
    │   └── tsconfig.json
    └── notes-service/               # ✅ User-scoped notes CRUD
        ├── prisma/
        │   ├── schema.prisma        # Note model
        │   └── migrations/
        ├── src/
        │   ├── index.ts             # Server bootstrap
        │   ├── app.ts               # Express app (1 MB body limit), routes, error handling
        │   ├── config.ts            # Env var validation; JWT settings must match auth-service
        │   ├── database.ts          # Prisma client
        │   ├── middleware.ts        # requireAuth configured with the shared JWT settings
        │   ├── validation.ts        # Joi schemas for bodies, list query and note ids
        │   ├── routes/              # notes.routes.ts
        │   ├── services/            # notes.service.ts (ownership-scoped queries, cursor pagination)
        │   └── generated/prisma/    # Generated Prisma client (gitignored)
        ├── test/                    # Integration tests, env setup, test-database setup
        ├── .env.example
        ├── prisma.config.ts
        └── tsconfig.json
```

---

## Project status

### ✅ Done

**Auth-service foundation**
- Express 5 app with JSON body parsing (100 KB limit) and `x-powered-by` disabled
- Environment variables validated at startup. The service refuses to boot with a clear message if anything is missing or invalid
- `GET /health` endpoint that checks the database, with a 2-second timeout. It returns `503` instead of hanging when the DB is unreachable
- Centralised error handling: JSON `404`s, `400` for malformed JSON, `500`s with details hidden in production
- Graceful shutdown on `SIGINT`/`SIGTERM`: drains connections, disconnects Prisma, force-exits after 10 seconds
- Strict TypeScript build and npm scripts for dev, build and database tasks

**Authentication**
- Register, login, refresh, logout and "current user" endpoints
- scrypt password hashing with OWASP-recommended parameters
- Short-lived JWT access tokens, pinned to algorithm and issuer
- Rotating refresh tokens, stored hashed in the database
- Reuse detection: replaying a used refresh token revokes all of that user's sessions
- Atomic rotation: concurrent refreshes with the same token cannot both succeed
- Unknown-email and wrong-password logins take the same time and return the same message, so registered emails can't be discovered
- Email normalisation (trim and lowercase) and per-field validation errors
- Per-account login lockout: 10 failed logins for one email in 15 minutes blocks that email from any IP, so credential stuffing spread across many IPs is stopped. Unknown emails lock out identically
- Initial database migration

**Shared package and monorepo**
- npm workspaces with a single root lockfile; `@notepad/shared` is linked into every service
- `@notepad/shared` builds on its own to `dist/` with type declarations
- Shared response helpers (`ok`, `fail`), `AppError`, error handlers and `validateBody`
- Shared JWT verification (`verifyAccessToken`, `createRequireAuth`), pinned to HS256 and issuer. `req.user` is typed in every service that imports the package
- The package reads no environment variables: services pass their settings in
- One-command dev loop: edits in `shared/` rebuild and restart the service automatically
- Refactor verified to be behaviour-preserving: the 19 responses checked were byte-for-byte identical before and after
- Shared `createHealthHandler` (2-second DB timeout) and `startServer` (graceful shutdown, fails fast if the port is taken), used by every service
- `validateQuery` for query strings, alongside `validateBody`

**Notes service**
- Create, list, get, update (partial) and delete notes: `title`, `content`, `isPinned`
- Its own database (`notepad_notes`); never calls the auth-service. Access tokens are verified locally
- Every query is scoped to the caller's user id from the token. Update and delete check ownership and write in a single statement
- Another user's note, an unknown id and a malformed id all return the same `404`, so note ids can't be probed
- List sorted pinned first, then most recently updated, with case-insensitive search (`?q=`), a `?pinned=` filter, and cursor pagination
- Cursor pagination never duplicates or skips untouched notes, even when notes are edited, deleted or created between pages
- Validation: title 1–200 characters, content up to 100,000 characters, 1 MB body limit; `userId`, `id` and timestamps can't be set by clients

**API gateway**
- Routes `/api/v1/auth/*` and `/api/v1/notes/*` to the services; everything else is a `404` that never reaches a service
- Streams request bodies (no parsing), rejects bodies over 1 MB early, and keeps query strings intact
- `502` in the standard envelope when a service is down, `504` when it's slower than the timeout (10s)
- Per-IP rate limits: global, login (failures only), register and refresh, with `RateLimit-*` and `Retry-After` headers
- `trust proxy` setting so limits use the real client IP behind a load balancer and can't be dodged with a fake `X-Forwarded-For`
- CORS allowlist, `helmet` security headers (HSTS in production only), `Cache-Control: no-store` on auth responses
- `X-Request-Id` on every request, forwarded to the services; one JSON log line per request with no tokens or query strings
- Aggregated `GET /health` (`503` naming any service that's down)
- Services gained a `HOST` setting so they can be bound to internal interfaces only

**Verified** end-to-end against a real PostgreSQL instance:
- **auth-service** (30 scenarios): the happy paths, tampered/expired/`alg=none`/wrong-issuer tokens, refresh rotation and reuse, concurrent refresh races, logout, and expired refresh tokens
- **notes-service** (51 scenarios), using real tokens from a running auth-service: cross-service token checks, CRUD and validation, ownership isolation between users (checked in the database), search and filters, and pagination under concurrent edits, deletes and creates
- Both suites pass **directly and through the gateway** (162 runs, identical results)
- **api-gateway** (62 scenarios, plus manual checks): routing and path rewriting, header forwarding, 413/502/504, every rate limit including bypass attempts (case, trailing slash, spoofed `X-Forwarded-For`), trust-proxy handling, CORS allow/deny, security headers, request ids, the per-account lockout from many IPs, and no secrets in logs

*The core of these checks is now an automated Jest + Supertest suite (see [Testing](#testing)).*

### 🚧 Not started
- User service
- CI

---

## Getting started

There are two ways to run the stack: everything in Docker, or the services on your machine with only PostgreSQL in Docker (best for development).

### Quick start: everything in Docker

Needs Docker with Compose v2.

```bash
cp .env.example .env
# in .env, set JWT_ACCESS_SECRET (openssl rand -base64 48) and POSTGRES_PASSWORD (openssl rand -hex 24)
docker compose up --build -d --wait
curl http://localhost:3000/health
```

This starts PostgreSQL (creating `notepad_auth` and `notepad_notes` on first run), applies both services' migrations as one-off jobs, then starts auth-service, notes-service and the gateway once each dependency is healthy. Only the gateway is published (`GATEWAY_PORT`, default `3000`). auth-service and notes-service are reachable only inside the compose network. Postgres is also published on `127.0.0.1:${POSTGRES_PORT:-5432}` for local tools and the integration tests.

| Command | Effect |
|---|---|
| `docker compose logs -f api-gateway` | Follow one service's logs |
| `docker compose up --build -d --wait` | Rebuild and restart after code changes; new migrations run automatically |
| `docker compose down` | Stop everything; data is kept in the `postgres-data` volume |
| `docker compose down -v` | Stop and delete the database volume |

Images come from the single root [`Dockerfile`](Dockerfile) (`--build-arg SERVICE=<name>`). It builds in a full install stage, then copies the compiled output into a runtime image with production dependencies only, running as the non-root `node` user. A `migrate` target holds the Prisma CLI for the migration jobs.

### Prerequisites (local development)

- Node.js **22+** and npm
- A PostgreSQL database (local install or Docker)

### 1. Start PostgreSQL

The quickest option is the compose file's Postgres service, which creates both databases on first start:

```bash
cp .env.example .env   # set JWT_ACCESS_SECRET and POSTGRES_PASSWORD; compose requires both even for one service
docker compose up -d postgres
```

Then use that password in each service's `DATABASE_URL`, e.g. `postgresql://postgres:<POSTGRES_PASSWORD>@localhost:5432/notepad_auth`.

Or with plain Docker:

```bash
docker run -d --name notepad-db \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  postgres:17-alpine

# one database per service
docker exec notepad-db psql -U postgres -c "CREATE DATABASE notepad_auth" -c "CREATE DATABASE notepad_notes"
```

### 2. Install dependencies

From the **repository root** (installs every workspace and links `@notepad/shared`):

```bash
npm install
```

### 3. Configure the services

```bash
cp services/api-gateway/.env.example services/api-gateway/.env
cp services/auth-service/.env.example services/auth-service/.env
cp services/notes-service/.env.example services/notes-service/.env
openssl rand -base64 48   # use the output as JWT_ACCESS_SECRET in BOTH auth and notes .env files
```

In the auth and notes `.env` files, set `DATABASE_URL` to that service's own database (`notepad_auth` or `notepad_notes`). The gateway's defaults work locally as they are; set `CORS_ORIGINS` to your front-end's origin.

> **`JWT_ACCESS_SECRET` and `JWT_ISSUER` must be identical in both services.** auth-service signs access tokens with them and notes-service verifies with them. If they differ, every notes request returns `401`.

> `DATABASE_URL` must be a standard `postgres://` or `postgresql://` connection string. Prisma's `prisma+postgres://` URLs are not supported by the driver adapter.

### 4. Migrate and run

```bash
npm run db:deploy -w auth-service    # applies migrations to notepad_auth
npm run db:deploy -w notes-service   # applies migrations to notepad_notes
npm run build                        # builds shared and generates both Prisma clients
npm run dev                          # watches shared + gateway (3000) + auth (3001) + notes (3002)
```

Everything restarts on changes to its own code or to `shared/`. Use `npm run dev:gateway`, `dev:auth` or `dev:notes` to run just one.

### 5. Check it works

```bash
curl http://localhost:3000/health
# {"success":true,"data":{"service":"api-gateway","status":"ok","upstreams":{"auth":"ok","notes":"ok"}}}

# register, then create a note with the returned access token (all through the gateway)
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/register -H "Content-Type: application/json" \
  -d '{"email":"ada@example.com","password":"Secure#Pass1"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.accessToken')
curl -X POST http://localhost:3000/api/v1/notes -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"My first note","content":"Hello"}'
```

---

## Configuration

### api-gateway

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Public HTTP port |
| `HOST` | all interfaces | Interface to bind |
| `AUTH_SERVICE_URL` | `http://localhost:3001` | Internal address of auth-service |
| `NOTES_SERVICE_URL` | `http://localhost:3002` | Internal address of notes-service |
| `UPSTREAM_TIMEOUT_MS` | `10000` | After this, the gateway gives up on a service and returns `504` |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allowed front-end origins. `*` is rejected |
| `TRUST_PROXY` | `0` | Number of load balancers in front of the gateway. `0` = clients connect directly. **Set this correctly**: too high lets clients fake their IP, too low puts every client behind one IP |
| `MAX_BODY_BYTES` | `1048576` (1 MB) | Larger requests are rejected with `413` before reaching a service |
| `RATE_LIMIT_<NAME>_MAX` / `_WINDOW_MS` | see [Rate limits](#rate-limits) | `NAME` is `GLOBAL`, `LOGIN`, `REGISTER` or `REFRESH` |
| `NODE_ENV` | `development` | `production` turns on HSTS and hides error details |

The gateway has no database and doesn't need the JWT secret.

### auth-service

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string (`postgresql://user:pass@host:5432/db?schema=public`) |
| `JWT_ACCESS_SECRET` | ✅ | — | HMAC secret for signing access tokens. Minimum 32 characters |
| `NODE_ENV` | | `development` | `development`, `test` or `production` |
| `PORT` | | `3001` | HTTP port |
| `ACCESS_TOKEN_TTL_SECONDS` | | `900` (15 min) | Access token lifetime. Minimum 60 |
| `REFRESH_TOKEN_TTL_DAYS` | | `7` | Refresh token lifetime. Minimum 1 |
| `JWT_ISSUER` | | `notepad-auth-service` | `iss` claim set on and required from access tokens |
| `LOGIN_MAX_FAILURES` | | `10` | Failed logins allowed per email before it's locked out (from any IP) |
| `LOGIN_LOCKOUT_WINDOW_MINUTES` | | `15` | Lockout window |
| `HOST` | | all interfaces | Interface to bind. In production use `127.0.0.1` or a private address so only the gateway can reach it |

### notes-service

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | Connection string for the notes database (separate from auth's) |
| `JWT_ACCESS_SECRET` | ✅ | — | **Must equal auth-service's value.** Used to verify access tokens |
| `JWT_ISSUER` | | `notepad-auth-service` | **Must equal auth-service's value** |
| `NODE_ENV` | | `development` | `development`, `test` or `production` |
| `PORT` | | `3002` | HTTP port |
| `HOST` | | all interfaces | Interface to bind (see auth-service) |

---

## API reference

Clients use the gateway only:

| Base URL (local) | Routes to |
|---|---|
| `http://localhost:3000/api/v1/auth/*` | auth-service `/auth/*` |
| `http://localhost:3000/api/v1/notes/*` | notes-service `/notes/*` |
| `http://localhost:3000/health` | the gateway's own aggregated health |

Endpoint paths below (`/auth/...`, `/notes/...`) are relative to `http://localhost:3000/api/v1`. Every response carries an `X-Request-Id` header; quote it when reporting a problem. Any route can also return `429` (see [Rate limits](#rate-limits)), `502` if a service is down, or `504` if it timed out.

### Response format

All responses share one envelope:

```jsonc
// success
{ "success": true, "data": { ... }, "message": "optional" }

// error
{ "success": false, "error": "Human-readable message", "errors": { "field": ["..."] } }
```

`errors` is only present on validation failures (`400`). Gateway errors (`404`, `413`, `429`, `502`, `504`) use the same envelope.

### Auth service endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/register` | — | Create an account |
| `POST` | `/auth/login` | — | Log in with email and password |
| `POST` | `/auth/refresh` | — | Exchange a refresh token for a new token pair |
| `POST` | `/auth/logout` | — | Revoke a refresh token |
| `GET` | `/auth/me` | Bearer | Get the current user |

---

#### `POST /auth/register`

```bash
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"ada@example.com","password":"Secure#Pass1"}'
```

**Rules**
- `email`: valid email, at most 254 characters, stored trimmed and lowercased
- `password`: 8–128 characters, with at least one uppercase letter, one lowercase letter and one number. Any symbols are allowed

**`201 Created`**

```json
{
  "success": true,
  "message": "Account created",
  "data": {
    "user": {
      "id": "6f1c…",
      "email": "ada@example.com",
      "createdAt": "2026-10-19T19:13:27.000Z",
      "updatedAt": "2026-10-19T19:13:27.000Z"
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIs…",
    "refreshToken": "Xq3v…",
    "tokenType": "Bearer",
    "expiresIn": 900
  }
}
```

**Errors:** `400` validation failed · `409` email already registered · `429` more than 5 registrations per hour from this IP

---

#### `POST /auth/login`

```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"ada@example.com","password":"Secure#Pass1"}'
```

**`200 OK`**: same `data` shape as register.

**Errors:** `400` validation failed · `401` `Invalid email or password` (the same response for unknown email and wrong password) · `429` too many failed logins from this IP (gateway) or for this account (auth-service, `Too many failed login attempts. Try again later.`). Both include `Retry-After`

---

#### `POST /auth/refresh`

```bash
curl -X POST http://localhost:3000/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"Xq3v…"}'
```

**`200 OK`**

```json
{
  "success": true,
  "data": {
    "accessToken": "eyJ…",
    "refreshToken": "new-token…",
    "tokenType": "Bearer",
    "expiresIn": 900
  }
}
```

The submitted refresh token is **revoked**, so the client must store the new one.

**Errors:** `400` missing token · `401` invalid, revoked or expired token · `429` more than 30 refreshes per minute

---

#### `POST /auth/logout`

```bash
curl -X POST http://localhost:3000/api/v1/auth/logout \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"Xq3v…"}'
```

**`200 OK`**: `{ "success": true, "message": "Logged out" }`

Idempotent: unknown or already-revoked tokens also return `200`. The access token stays valid until it expires (15 minutes at most).

---

#### `GET /auth/me`

```bash
curl http://localhost:3000/api/v1/auth/me \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs…"
```

**`200 OK`**: `{ "success": true, "data": { "user": { "id", "email", "createdAt", "updatedAt" } } }`

**Errors:** `401` missing, malformed, invalid or expired access token

---

#### `GET /health` (gateway, `http://localhost:3000/health`)

```json
{ "success": true, "data": { "service": "api-gateway", "status": "ok", "upstreams": { "auth": "ok", "notes": "ok" } } }
```

| Status | Meaning |
|---|---|
| `200` | Gateway up, and every service reports healthy |
| `503` | At least one service is down or slower than 2 seconds; `upstreams` shows which |

Not rate limited. Each service also has its own internal `GET /health` (database check) that the gateway uses.

---

### Notes service endpoints

Every `/notes` route requires `Authorization: Bearer <accessToken>` from the auth-service. A user can only ever see and change their own notes.

| Method | Path | Description |
|---|---|---|
| `POST` | `/notes` | Create a note |
| `GET` | `/notes` | List my notes (paginated, searchable) |
| `GET` | `/notes/:id` | Get one note |
| `PATCH` | `/notes/:id` | Update some or all fields |
| `DELETE` | `/notes/:id` | Delete a note |

**Note object**

```json
{
  "id": "e815ec64-e8eb-4bf7-b6b0-2c1f3a9d4e77",
  "title": "Shopping list",
  "content": "Milk, Eggs",
  "isPinned": false,
  "createdAt": "2026-10-22T19:12:03.120Z",
  "updatedAt": "2026-10-22T19:12:03.120Z"
}
```

**Not found:** another user's note, an id that doesn't exist and a malformed id all return the same `404 {"success":false,"error":"Note not found"}`. This is deliberate, so nobody can tell whether a note id exists.

---

#### `POST /notes`

```bash
curl -X POST http://localhost:3000/api/v1/notes \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Shopping list","content":"Milk, Eggs","isPinned":false}'
```

| Field | Rules |
|---|---|
| `title` | **Required.** 1–200 characters after trimming |
| `content` | Optional, default `""`. Up to 100,000 characters |
| `isPinned` | Optional boolean, default `false` |

Any other fields (`userId`, `id`, `createdAt`, …) are ignored.

**`201 Created`**: `{ "success": true, "message": "Note created", "data": { "note": { … } } }`

**Errors:** `400` validation failed · `401` missing or invalid token · `413` body larger than 1 MB

---

#### `GET /notes`

```bash
curl "http://localhost:3000/api/v1/notes?limit=20&q=milk" -H "Authorization: Bearer $TOKEN"
```

| Query | Rules |
|---|---|
| `limit` | 1–100, default `20` |
| `cursor` | The `nextCursor` value from the previous page |
| `q` | Case-insensitive search in title and content, up to 200 characters |
| `pinned` | `true` or `false` to filter |

Sorted pinned first, then most recently updated.

**`200 OK`**

```json
{
  "success": true,
  "data": {
    "notes": [ { "id": "…", "title": "…", "content": "…", "isPinned": true, "createdAt": "…", "updatedAt": "…" } ],
    "nextCursor": "eyJwIjp0cnVlLCJ1Ijoi…"
  }
}
```

`nextCursor` is `null` on the last page. Pass it back unchanged as `?cursor=` to get the next page. The cursor marks a position in the sort order, not a page number, so notes added, edited or deleted between requests never cause an untouched note to be skipped or repeated. A note edited mid-way moves to the top of the list, so it won't reappear on later pages.

**Errors:** `400` invalid `limit`, `pinned`, `q` or cursor · `401`

---

#### `GET /notes/:id`

**`200 OK`**: `{ "success": true, "data": { "note": { … } } }` · **Errors:** `401` · `404`

---

#### `PATCH /notes/:id`

```bash
curl -X PATCH http://localhost:3000/api/v1/notes/$NOTE_ID \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"isPinned":true}'
```

Send any of `title`, `content`, `isPinned` (same rules as create). At least one is required, and fields you leave out are unchanged. `updatedAt` is refreshed.

**`200 OK`**: `{ "success": true, "message": "Note updated", "data": { "note": { … } } }`

**Errors:** `400` validation failed or empty body · `401` · `404`

---

#### `DELETE /notes/:id`

**`200 OK`**: `{ "success": true, "message": "Note deleted" }` · **Errors:** `401` · `404` (including when it's already deleted)

---

## Authentication design

### Token lifecycle

```
register / login
      │
      ▼
 ┌─────────────────────────────────────────┐
 │ accessToken  (JWT, 15 min)              │──▶ Authorization: Bearer … on API calls
 │ refreshToken (opaque, 7 days)           │
 └─────────────────────────────────────────┘
      │  access token expires
      ▼
 POST /auth/refresh { refreshToken }
      │  old refresh token revoked, new pair issued
      ▼
 repeat… until POST /auth/logout
```

### Security measures

| Measure | Why |
|---|---|
| **scrypt** (N=2¹⁵, r=8, p=3, 16-byte salt, 64-byte key) | Memory-hard hashing resists GPU cracking. Parameters are stored in each hash (`scrypt$N$r$p$salt$hash`), so they can be raised later without invalidating existing passwords |
| **Constant-time comparison** (`timingSafeEqual`) | Prevents timing attacks on hash comparison |
| **Dummy hash for unknown emails** | Unknown-email logins take as long as wrong-password logins, so attackers can't discover which emails are registered |
| **Access tokens pinned to `HS256` and issuer** | Rejects `alg=none`, algorithm-confusion attacks and tokens from other issuers |
| **Opaque refresh tokens** (32 random bytes) | Not decodable and carry no claims |
| **Refresh tokens stored as SHA-256** | A database leak does not expose usable sessions |
| **Rotation on every refresh** | Each refresh token works exactly once |
| **Reuse detection** | Replaying a revoked refresh token signals theft, so every session for that user is revoked |
| **Atomic rotation** (conditional `UPDATE … WHERE revoked_at IS NULL`) | When two concurrent refreshes use the same token, only one succeeds |
| **Password length cap (128)** | Stops very long passwords from being used to waste CPU on hashing |
| **Email normalisation** | `Ada@Example.com` and `ada@example.com` are the same account |
| **`stripUnknown` on request bodies** | Only expected fields reach the business logic |
| **No `password` in any response** | User objects are selected without the hash |
| **Notes scoped by token, not input** (notes-service) | The owner always comes from the verified token's `sub`. Clients can't pass a `userId` |
| **Single-statement ownership checks** (notes-service) | `UPDATE/DELETE … WHERE id = ? AND user_id = ?`, so there's no gap between checking ownership and writing |
| **Uniform `404` for foreign notes** (notes-service) | Note ids can't be probed to learn whether they exist |
| **Per-IP rate limits** (gateway) | Slows down password guessing, mass registration and floods; only failed logins count |
| **Per-account login lockout** (auth-service) | Stops credential stuffing spread across many IPs, which per-IP limits can't |
| **`trust proxy` set explicitly** (gateway) | Rate limits key on the real client IP and can't be dodged by faking `X-Forwarded-For` |
| **Services internal-only** (`HOST`) | Nobody can skip the gateway's limits by calling a service directly |
| **No JWT secret in the gateway** | One fewer place the signing secret can leak from |

---

## Database schema

**auth-service**: `prisma/schema.prisma`

```
users
├── id           text (UUID, PK)
├── email        text, unique
├── password     text (scrypt hash)
├── created_at   timestamp
└── updated_at   timestamp

refresh_tokens
├── id           text (UUID, PK)
├── user_id      text → users.id (ON DELETE CASCADE), indexed
├── token_hash   text, unique (SHA-256 of the token)
├── expires_at   timestamp
├── revoked_at   timestamp, nullable
└── created_at   timestamp
```

**notes-service**: `prisma/schema.prisma` (separate database)

```
notes
├── id           text (UUID, PK)
├── user_id      text (auth-service user id from the token; no FK, different database)
├── title        varchar(200)
├── content      text, default ''
├── is_pinned    boolean, default false
├── created_at   timestamp
└── updated_at   timestamp

index (user_id, is_pinned DESC, updated_at DESC, id DESC)   -- matches the list query's sort order
```

---

## API gateway

### Request pipeline

```
request → X-Request-Id → access log → security headers → CORS → /health?
        → global rate limit → body size check → route rate limit → proxy → service
```

CORS comes before rate limiting, so preflights aren't counted and `429` responses still carry CORS headers a browser can read.

### Rate limits

Per client IP, per gateway instance:

| Route | Default | Notes |
|---|---|---|
| Everything | 300 / minute | |
| `POST /auth/login` | **5 failed attempts / 15 minutes** | Successful logins don't count. Once the limit is hit, every login from that IP is blocked until the window resets |
| `POST /auth/register` | 5 / hour | |
| `POST /auth/refresh` | 30 / minute | |
| `GET /health` | not limited | |

Responses include `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` and `RateLimit-Policy` headers; a `429` also includes `Retry-After` (seconds). Route matching is case-insensitive and ignores a trailing slash, so `/auth/LOGIN` and `/auth/login/` are limited too.

On top of this, auth-service locks out **an account** after 10 failed logins in 15 minutes, whatever IP they come from.

### CORS

- Only origins listed in `CORS_ORIGINS` get CORS headers. Others are not rejected by the gateway, but browsers block the response.
- Allowed methods: `GET`, `POST`, `PATCH`, `DELETE`. Allowed headers: `Authorization`, `Content-Type`, `X-Request-Id`.
- No credentials mode: tokens are sent in the `Authorization` header, not cookies.
- Browser code can read `X-Request-Id`, `RateLimit-*` and `Retry-After`. Preflights are cached for 10 minutes.

### Security headers

| Header | Value |
|---|---|
| `Content-Security-Policy` | `default-src 'none'; frame-ancestors 'none'` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |
| `Cross-Origin-Resource-Policy` | `same-site` |
| `Strict-Transport-Security` | `max-age=15552000; includeSubDomains` (**production only**) |
| `Cache-Control` | `no-store` on every `/auth/*` response |

`X-Powered-By` is removed, including from service responses.

### Logging

One JSON line per request: method, path (no query string), status, duration, client address and request id. `Authorization` headers, cookies and bodies are never logged. Upstream failures are logged with the service name and request id.

---

## Shared package

`@notepad/shared` is consumed like any npm package. A service adds `"@notepad/shared": "*"` to its dependencies and runs `npm install` at the root.

```ts
import express from "express";
import { createErrorHandler, createRequireAuth, notFoundHandler, ok, validateBody } from "@notepad/shared";

const requireAuth = createRequireAuth({ secret: process.env.JWT_ACCESS_SECRET!, issuer: "notepad-auth-service" });

const app = express();
app.use(express.json());
app.get("/notes", requireAuth, (req, res) => {
    res.json(ok({ owner: req.user!.id }));       // req.user is typed
});
app.use(notFoundHandler);
app.use(createErrorHandler({ exposeDetails: process.env.NODE_ENV !== "production" }));
```

| Export | Purpose |
|---|---|
| `ApiResponse`, `User`, `AuthUser`, `AccessTokenPayload` | Shared types |
| `ok(data?, message?)` / `fail(error, errors?)` | Build the standard response envelope |
| `AppError(status, message, errors?, headers?)` | Throw from anywhere; the error handler turns it into a JSON response (with any extra headers, e.g. `Retry-After`) |
| `notFoundHandler`, `createErrorHandler({ exposeDetails })` | JSON 404 and centralised error handling |
| `validateBody(joiSchema)` / `validateQuery(joiSchema)` | Validate and sanitise `req.body` / `req.query`, with per-field errors |
| `createHealthHandler({ service, checkDatabase, timeoutMs? })` | Standard `GET /health` handler: `503` if the check fails or takes longer than 2 seconds |
| `startServer(app, { name, port, host?, nodeEnv, onShutdown? })` | Listen (optionally on one interface), exit with an error if the port is taken, shut down gracefully on SIGINT/SIGTERM |
| `verifyAccessToken(token, { secret, issuer })` | Verify an access token (HS256 only) |
| `createRequireAuth({ secret, issuer })` | Middleware that requires a Bearer token and sets `req.user` |

`express`, `joi` and `jsonwebtoken` are **peer dependencies**, so each service provides them. This keeps a single copy of Express, which the `req.user` typing depends on.

---

## Available scripts

### Repository root

| Script | Description |
|---|---|
| `npm run build` | Build `shared`, then every service |
| `npm run typecheck` | Build `shared`, then type-check every workspace |
| `npm run dev` | Watch `shared`, the gateway, auth-service and notes-service together, with live reload |
| `npm run dev:gateway` | Watch `shared` and the gateway only |
| `npm run dev:auth` | Watch `shared` and auth-service only |
| `npm run dev:notes` | Watch `shared` and notes-service only |
| `npm run lint` | Lint every workspace with ESLint (type-aware rules) |
| `npm run lint:fix` | Lint and apply automatic fixes |
| `npm run format` | Format all files with Prettier |
| `npm run format:check` | Check formatting without writing (for CI) |
| `npm test` | Run every test: unit and integration (needs PostgreSQL, see [Testing](#testing)) |
| `npm run test:unit` | Unit and gateway tests only; no database or running services needed |
| `npm run test:integration` | auth-service and notes-service against a real test database |
| `npm run test:coverage` | Full suite with a coverage report and minimum thresholds |

ESLint uses type information, so `shared` must be built and the Prisma clients generated (`npm run build` does both) before `npm run lint`. Otherwise imports from those packages resolve to `any` and the lint reports false errors. Markdown is excluded from Prettier so tables stay hand-formatted.

To hide the one-off formatting commit from `git blame`, run once: `git config blame.ignoreRevsFile .git-blame-ignore-revs`. GitHub applies it automatically.

### Inside each service (`services/auth-service`, `services/notes-service`)

These also work from the root with `-w <service>`, e.g. `npm run db:migrate -w notes-service`. The gateway has `dev`, `build`, `start` and `typecheck` only (no database).

| Script | Description |
|---|---|
| `npm run dev` | Start with live reload (`tsx watch`) |
| `npm run build` | Generate the Prisma client and compile to `dist/` |
| `npm start` | Run the compiled build (`node dist/index.js`) |
| `npm run typecheck` | Type-check without emitting |
| `npm run db:migrate` | Create and apply a migration in development |
| `npm run db:deploy` | Apply pending migrations (production/CI) |
| `npm run db:generate` | Regenerate the Prisma client |
| `npm run db:studio` | Open Prisma Studio to browse data |

---

## Testing

Tests use **Jest** with **Supertest**, compiled by SWC (`npm run typecheck` checks test types). They call each service's `createApp()` directly, so no server needs to be running.

| Jest project | What it covers | Needs |
|---|---|---|
| `shared` | Error handler, validation, health check, JWT verification and `requireAuth` | Nothing |
| `api-gateway` | Routing and path rewriting, request ids, security headers, CORS, 413/502/504, health, every rate limit | Nothing (fake upstream servers on random ports) |
| `auth-service` | Password hashing, tokens, per-account lockout, validation schemas | Nothing |
| `notes-service` | Validation schemas | Nothing |
| `auth-service:integration` | Register, login, lockout, refresh rotation and replay detection, logout, `/me` | PostgreSQL |
| `notes-service:integration` | CRUD, ownership isolation, search, filters, cursor pagination | PostgreSQL |

Run one project with `npx jest --selectProjects <name>`, or one file with `npx jest <path>`.

**Integration test database.** Integration tests connect to `TEST_POSTGRES_URL` (default `postgresql://postgres:postgres@localhost:5432`, which matches the plain `docker run` container from [Getting started](#1-start-postgresql)). Before each run, Jest creates `notepad_auth_test` and `notepad_notes_test` if needed, applies migrations and empties them. Development databases are never touched; the setup refuses any database name that doesn't end in `_test`.

```bash
# The compose Postgres (docker compose up -d postgres), using POSTGRES_PASSWORD from .env
TEST_POSTGRES_URL=postgresql://postgres:<POSTGRES_PASSWORD>@localhost:5432 npm test

# Any other server or credentials
TEST_POSTGRES_URL=postgresql://user:pass@db-host:5432 npm run test:integration
```

**Test configuration.** Each service's `test/setup-env.ts` sets every environment variable its config reads, so a local `.env` never affects test results. Auth tests lower `LOGIN_MAX_FAILURES` to 3 to keep lockout tests fast.

**Isolation.** Each test registers its own random user, so tests don't share rows and need no per-test cleanup. Gateway tests load a fresh copy of the app for each scenario, so rate-limit counters start at zero.

**Before the first integration run** on a fresh clone, generate the Prisma clients (`npm run build` does this). The generated clients aren't committed.

---

## Roadmap

| # | Milestone | Status |
|---|---|---|
| 1 | Make auth-service runnable (server, DB, health, errors, config) | ✅ Done |
| 2 | Auth endpoints (register, login, refresh, logout, me) | ✅ Done |
| 3 | Initial database migration | ✅ Done |
| 4 | Turn `shared/` into a proper package (npm workspaces, build, response helpers, shared JWT-verification middleware) | ✅ Done |
| 5 | **Notes service**: own database, user-scoped CRUD, JWT-protected | ✅ Done |
| 6 | API gateway: routing, **rate limiting** (especially login), CORS, security headers | ✅ Done |
| 7 | Tooling: ESLint + Prettier ✅, Jest + Supertest suite ✅, `docker-compose.yml` ✅, GitHub Actions CI | ⏳ Next |
| 8 | Documentation: OpenAPI spec, per-service READMEs | ⏳ |

---

## Known limitations

- **Rate-limit and lockout counters live in memory.** They're per instance and reset on restart. Running several gateway or auth instances needs a shared store such as Redis (planned as a follow-up: `rate-limit-redis` in the gateway and a Redis-backed lockout in auth-service).
- **The account lockout can be used to lock someone out.** Anyone who knows an email can fail 10 logins and block that account for 15 minutes. This is the usual trade-off against credential stuffing; CAPTCHA or emailed unlock links would soften it.
- **Docker Desktop hides client IPs.** On macOS and Windows, every request to the published gateway port appears to come from one internal address, so the per-IP rate limits are shared by all clients. Linux hosts keep real client IPs. Production should put the gateway behind a load balancer and set `TRUST_PROXY`.
- **The compose file is for local use.** Every service connects as the `postgres` superuser, with the password from `.env`. Production needs per-service database users and secrets from a secret manager.
- **No TLS yet.** Production needs HTTPS terminated in front of the gateway (a load balancer or nginx), with `TRUST_PROXY` set to match.
- **The gateway's body-size check relies on `Content-Length`.** Chunked uploads skip it, but each service still enforces its own limit (auth 100 KB, notes 1 MB).
- **Revoked and expired refresh tokens are never cleaned up.** A periodic cleanup job is needed.
- **No "log out of all devices" or password-change endpoint yet.** The internal revoke-all logic already exists.
- **Access tokens can't be revoked before they expire.** Logout revokes the refresh token only, and the access token stays valid for up to 15 minutes. This is the standard trade-off for stateless JWTs.
- **Any service holding the JWT secret could also forge tokens.** HS256 uses one secret for signing and verifying, and notes-service has it. Switching to RS256 (auth signs with a private key, other services verify with the public key) is the recommended next security step.
- **Concurrent edits to the same note: last write wins.** Two devices editing one note can overwrite each other. Optimistic locking (send the last seen `updatedAt`, get `409` on conflict) would prevent it.
- **Notes outlive their owner.** There's no foreign key across databases, so if account deletion is added, the notes-service will need to be told (an event or cleanup job).
- **Search uses `ILIKE`**, which scans a user's notes. That's fine at this scale, but Postgres full-text search or `pg_trgm` would be needed for large accounts.
- **`shared/` must be built before services compile.** The root `build`, `typecheck` and `dev*` scripts handle this. If you run a service script directly after a fresh clone, run `npm run build -w @notepad/shared` first.
