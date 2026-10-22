# Notepad API

A note-taking backend built on a microservices architecture with **Node.js**, **TypeScript**, **Express** and **PostgreSQL**.

Each service owns its own database and is deployed independently. Services trust each other through signed JWT access tokens issued by the auth service.

> **Status:** early development. The **auth-service** is functional end-to-end. The notes and user services are not built yet. See [Project status](#project-status) and [Roadmap](#roadmap).

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
- [Shared package](#shared-package)
- [Available scripts](#available-scripts)
- [Roadmap](#roadmap)
- [Known limitations](#known-limitations)

---

## Architecture

```
                    ┌──────────────────────┐
   Client ────────▶ │  API Gateway (planned)│  routing, rate limiting, CORS
                    └──────────┬───────────┘
              ┌────────────────┼─────────────────┐
              ▼                ▼                 ▼
     ┌────────────────┐ ┌──────────────┐ ┌────────────────┐
     │  auth-service  │ │ user-service │ │ notes-service  │
     │   ✅ working    │ │  (planned)   │ │   (planned)    │
     └───────┬────────┘ └──────┬───────┘ └───────┬────────┘
             ▼                 ▼                 ▼
       ┌──────────┐      ┌──────────┐      ┌──────────┐
       │ Postgres │      │ Postgres │      │ Postgres │
       │  (auth)  │      │  (user)  │      │ (notes)  │
       └──────────┘      └──────────┘      └──────────┘
```

- **Database per service.** No service reads another service's tables.
- **Stateless auth between services.** The auth-service issues short-lived JWT access tokens. Other services verify them locally with the shared secret, so no call to the auth-service is needed per request.
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
├── shared/                          # @notepad/shared, compiled to dist/
│   ├── src/
│   │   ├── index.ts                 # Public entry point
│   │   ├── types/                   # User, ApiResponse, AuthUser, AccessTokenPayload
│   │   ├── http/                    # AppError, ok/fail, error handlers, validateBody
│   │   └── auth/                    # verifyAccessToken, createRequireAuth, req.user typing
│   └── tsconfig.json
└── services/
    ├── auth-service/                # ✅ Registration, login, token lifecycle
    │   ├── prisma/
    │   │   ├── schema.prisma        # User, RefreshToken models
    │   │   └── migrations/          # Versioned SQL migrations
    │   ├── src/
    │   │   ├── index.ts             # Server bootstrap + graceful shutdown
    │   │   ├── app.ts               # Express app, routes, error handling
    │   │   ├── config.ts            # Env var validation (fails fast)
    │   │   ├── database.ts          # Prisma client + DB health check
    │   │   ├── middleware.ts        # requireAuth configured with this service's JWT settings
    │   │   ├── validation.ts        # Joi request schemas
    │   │   ├── routes/              # auth.routes.ts
    │   │   ├── services/            # auth.service.ts (business logic)
    │   │   ├── utils/               # password.ts (scrypt), tokens.ts (signing, refresh tokens)
    │   │   └── generated/prisma/    # Generated Prisma client (gitignored)
    │   ├── .env.example
    │   ├── prisma.config.ts
    │   └── tsconfig.json
    └── …                            # notes-service and user-service will live here
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
- Initial database migration

**Shared package and monorepo**
- npm workspaces with a single root lockfile; `@notepad/shared` is linked into every service
- `@notepad/shared` builds on its own to `dist/` with type declarations
- Shared response helpers (`ok`, `fail`), `AppError`, error handlers and `validateBody`
- Shared JWT verification (`verifyAccessToken`, `createRequireAuth`), pinned to HS256 and issuer. `req.user` is typed in every service that imports the package
- The package reads no environment variables: services pass their settings in
- One-command dev loop: edits in `shared/` rebuild and restart the service automatically
- Refactor verified to be behaviour-preserving: the 19 responses checked were byte-for-byte identical before and after

**Verified** end-to-end against a real PostgreSQL instance (30 scenarios). The checks covered the happy paths, tampered/expired/`alg=none`/wrong-issuer tokens, refresh rotation and reuse, concurrent refresh races, logout, and expired refresh tokens. *These checks have not yet been committed as an automated test suite (see roadmap).*

### 🚧 Not started
- Notes service (the core product)
- User service
- API gateway
- Automated tests, linting, Docker, CI

---

## Getting started

### Prerequisites

- Node.js **22+** and npm
- A PostgreSQL database (local install or Docker)

### 1. Start PostgreSQL

The quickest option is Docker:

```bash
docker run -d --name notepad-auth-db \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=notepad_auth \
  -p 5432:5432 \
  postgres:17-alpine
```

### 2. Install dependencies

From the **repository root** (installs every workspace and links `@notepad/shared`):

```bash
npm install
```

### 3. Configure the auth-service

```bash
cd services/auth-service
cp .env.example .env
```

Edit `.env`. At minimum, set `DATABASE_URL` and a `JWT_ACCESS_SECRET`:

```bash
openssl rand -base64 48   # paste the output into JWT_ACCESS_SECRET
```

> `DATABASE_URL` must be a standard `postgres://` or `postgresql://` connection string. Prisma's `prisma+postgres://` URLs are not supported by the driver adapter.

### 4. Migrate and run

```bash
# still in services/auth-service
npm run db:migrate     # applies migrations and generates the Prisma client

# back at the repository root
cd ../..
npm run dev:auth       # builds shared, then watches shared + auth-service
```

The service starts on http://localhost:3001 and restarts on changes to its own code or to `shared/`.

### 5. Check it works

```bash
curl http://localhost:3001/health
# {"success":true,"data":{"service":"auth-service","status":"ok","database":true}}
```

---

## Configuration

Environment variables for the auth-service:

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string (`postgresql://user:pass@host:5432/db?schema=public`) |
| `JWT_ACCESS_SECRET` | ✅ | — | HMAC secret for signing access tokens. Minimum 32 characters |
| `NODE_ENV` | | `development` | `development`, `test` or `production` |
| `PORT` | | `3001` | HTTP port |
| `ACCESS_TOKEN_TTL_SECONDS` | | `900` (15 min) | Access token lifetime. Minimum 60 |
| `REFRESH_TOKEN_TTL_DAYS` | | `7` | Refresh token lifetime. Minimum 1 |
| `JWT_ISSUER` | | `notepad-auth-service` | `iss` claim set on and required from access tokens |

---

## API reference

Base URL (local): `http://localhost:3001`

### Response format

All responses share one envelope:

```jsonc
// success
{ "success": true, "data": { ... }, "message": "optional" }

// error
{ "success": false, "error": "Human-readable message", "errors": { "field": ["..."] } }
```

`errors` is only present on validation failures (`400`).

### Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | — | Service and database health |
| `POST` | `/auth/register` | — | Create an account |
| `POST` | `/auth/login` | — | Log in with email and password |
| `POST` | `/auth/refresh` | — | Exchange a refresh token for a new token pair |
| `POST` | `/auth/logout` | — | Revoke a refresh token |
| `GET` | `/auth/me` | Bearer | Get the current user |

---

#### `POST /auth/register`

```bash
curl -X POST http://localhost:3001/auth/register \
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

**Errors:** `400` validation failed · `409` email already registered

---

#### `POST /auth/login`

```bash
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"ada@example.com","password":"Secure#Pass1"}'
```

**`200 OK`**: same `data` shape as register.

**Errors:** `400` validation failed · `401` `Invalid email or password` (the same response for unknown email and wrong password)

---

#### `POST /auth/refresh`

```bash
curl -X POST http://localhost:3001/auth/refresh \
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

**Errors:** `400` missing token · `401` invalid, revoked or expired token

---

#### `POST /auth/logout`

```bash
curl -X POST http://localhost:3001/auth/logout \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"Xq3v…"}'
```

**`200 OK`**: `{ "success": true, "message": "Logged out" }`

Idempotent: unknown or already-revoked tokens also return `200`. The access token stays valid until it expires (15 minutes at most).

---

#### `GET /auth/me`

```bash
curl http://localhost:3001/auth/me \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs…"
```

**`200 OK`**: `{ "success": true, "data": { "user": { "id", "email", "createdAt", "updatedAt" } } }`

**Errors:** `401` missing, malformed, invalid or expired access token

---

#### `GET /health`

| Status | Meaning |
|---|---|
| `200` | Service up, database reachable |
| `503` | Service up, database unreachable or slower than 2 seconds |

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
| `AppError(status, message, errors?)` | Throw from anywhere; the error handler turns it into a JSON response |
| `notFoundHandler`, `createErrorHandler({ exposeDetails })` | JSON 404 and centralised error handling |
| `validateBody(joiSchema)` | Validate and sanitise `req.body`, with per-field errors |
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
| `npm run dev:auth` | Watch `shared` and auth-service together, with live reload |

### `services/auth-service`

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

## Roadmap

| # | Milestone | Status |
|---|---|---|
| 1 | Make auth-service runnable (server, DB, health, errors, config) | ✅ Done |
| 2 | Auth endpoints (register, login, refresh, logout, me) | ✅ Done |
| 3 | Initial database migration | ✅ Done |
| 4 | Turn `shared/` into a proper package (npm workspaces, build, response helpers, shared JWT-verification middleware) | ✅ Done |
| 5 | **Notes service**: own database, user-scoped CRUD, JWT-protected | ⏳ Next |
| 6 | API gateway: routing, **rate limiting** (especially login), CORS, security headers | ⏳ |
| 7 | Tooling: ESLint + Prettier, Vitest/Jest + Supertest suite, `docker-compose.yml`, GitHub Actions CI | ⏳ |
| 8 | Documentation: OpenAPI spec, per-service READMEs | ⏳ |

---

## Known limitations

- **No rate limiting yet.** Each login does about 0.3 seconds of deliberate hashing work, so floods of login attempts should be throttled at the gateway (roadmap item 6).
- **Revoked and expired refresh tokens are never cleaned up.** A periodic cleanup job is needed.
- **No "log out of all devices" or password-change endpoint yet.** The internal revoke-all logic already exists.
- **Access tokens can't be revoked before they expire.** Logout revokes the refresh token only, and the access token stays valid for up to 15 minutes. This is the standard trade-off for stateless JWTs.
- **`shared/` must be built before services compile.** The root `build`, `typecheck` and `dev:auth` scripts handle this. If you run a service script directly after a fresh clone, run `npm run build -w @notepad/shared` first.
