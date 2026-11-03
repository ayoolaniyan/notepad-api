# AGENTS.md

Guide for coding agents working in this repository. The [README](README.md) has the full human docs; this file is the short version.

## Layout

npm workspaces monorepo, TypeScript (strict, CommonJS), Node 22.

| Path | What it is |
|---|---|
| `shared/` | `@notepad/shared`: response helpers (`ok`, `fail`), `AppError`, Joi validation middleware, error handler, health, `startServer`, JWT verification and `requireAuth` |
| `services/api-gateway/` | Public entry point (`:3000`): routing under `/api/v1`, rate limits, CORS, security headers. No database |
| `services/auth-service/` | Accounts and tokens (`:3001`, internal), own Postgres database via Prisma |
| `services/notes-service/` | Notes CRUD (`:3002`, internal), own Postgres database via Prisma |
| `services/mcp-server/` | MCP server for AI agents (stdio). Talks only to the gateway over HTTP. See its [README](services/mcp-server/README.md) |
| `docs/openapi.yaml` | OpenAPI 3.1 contract for the public API |
| `jest.config.mjs` | One Jest project per package, plus `*:integration` projects |

## Commands

Run from the repository root.

| Task | Command |
|---|---|
| Install | `npm ci` |
| Build everything (shared, Prisma clients, services, mcp-server) | `npm run build` |
| Lint / format check | `npm run lint` / `npm run format:check` (fix with `npm run lint:fix` / `npm run format`) |
| Typecheck | `npm run typecheck` |
| Unit tests (no services needed) | `npm run test:unit` |
| Integration tests (need PostgreSQL) | `TEST_POSTGRES_URL=postgresql://postgres:<password>@localhost:5432 npm run test:integration` |
| Everything with coverage (what CI runs) | `npm run test:coverage` |
| One Jest project | `npx jest --selectProjects <name>`, e.g. `mcp-server` |
| MCP deterministic evals (need PostgreSQL) | `npm run evals -w mcp-server` |
| OpenAPI lint | `npm run docs:lint` |
| Full stack in Docker | `cp .env.example .env` (set `JWT_ACCESS_SECRET`, `POSTGRES_PASSWORD`), then `docker compose up --build` |
| Postgres only, for tests | `docker compose up -d postgres` |

Before the first integration run on a fresh clone, run `npm run build` so the Prisma clients exist.

## API conventions

- **Base path:** every public route is under `/api/v1` on the gateway (`/api/v1/auth/*`, `/api/v1/notes`). `GET /health` is the only route outside it.
- **Envelope:** success is `{ "success": true, "data": ..., "message"?: ... }`. Failure is `{ "success": false, "error": "...", "errors"?: { "<field>": ["..."] } }`. `errors` is an object of field → messages, not an array. Build responses with `ok()` / `fail()` from `@notepad/shared` and throw `AppError` for expected failures.
- **Validation:** Joi schemas in each service's `validation.ts`, applied with `validateBody` / `validateQuery`. Unknown fields are stripped.
- **Auth:** `Authorization: Bearer <accessToken>`. Access tokens are HS256 JWTs (15 min by default), and the `sub` claim is the user id. Refresh tokens are opaque, rotate on every use, and reuse revokes all of the user's sessions.
- **Ownership rule:** every notes query is scoped to `req.user.id`, which comes from the verified token's `sub`. Never take a user id from the request body or query. Ownership is checked in the same statement as the write (`updateManyAndReturn` / `deleteMany` with `where: { id, userId }`).
- **Not found:** missing, malformed and other users' note ids all return the same `404 Note not found`.
- **Limits:** title 1-200 characters (trimmed), content up to 100,000, list `limit` 1-100 (default 20), `q` 1-200, keyset `cursor` from `nextCursor`.

## Code style

- Prettier: 4 spaces (2 for JSON/YAML), double quotes, semicolons, trailing commas, width 120. ESLint uses typescript-eslint's type-checked rules.
- Tests sit next to the code as `*.test.ts`. Integration tests live in `test/*.int.test.ts` and register a fresh random user per test instead of cleaning up.

## Do not

- Don't change response shapes, status codes or limits without updating `docs/openapi.yaml` and the tests together.
- Don't read a user id from request input in notes-service, and don't add a notes query without `userId` in its `where`.
- Don't log or return passwords, password hashes, access tokens or refresh tokens, including in tests, fixtures and error messages.
- Don't point integration tests at a database whose name doesn't end in `_test`. The global setups wipe them on every run.
- Don't import one service's code from another, or from mcp-server. Shared code goes in `shared/`, and mcp-server only talks to the gateway over HTTP.
- Don't commit `.env` files, generated Prisma clients (`src/generated/`), `dist/` or `services/mcp-server/evals/results/`.
- Don't hand-edit `package-lock.json`, and don't upgrade dependencies as a side effect of another change.
