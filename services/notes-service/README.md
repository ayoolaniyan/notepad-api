# notes-service

User-scoped notes for [notepad-api](../../README.md): create, list (search, filter, cursor pagination), get, update and delete. Every request needs an access token from auth-service, which this service verifies locally. It never calls auth-service.

- **Port:** `3002` (internal; clients reach it through the gateway at `/api/v1/notes/*`)
- **Database:** `notepad_notes` (PostgreSQL, Prisma), separate from auth-service's
- **API contract:** [`docs/openapi.yaml`](../../docs/openapi.yaml) · examples in the [root API reference](../../README.md#notes-service-endpoints)

---

## Endpoints

Paths are as the service sees them; the gateway serves them under `/api/v1`. Every `/notes` route requires `Authorization: Bearer <accessToken>`.

| Method | Path | Description |
|---|---|---|
| `POST` | `/notes` | Create a note (`201`) |
| `GET` | `/notes` | List my notes: `?limit=`, `?cursor=`, `?q=`, `?pinned=` |
| `GET` | `/notes/:id` | Get one note |
| `PATCH` | `/notes/:id` | Update any of `title`, `content`, `isPinned` |
| `DELETE` | `/notes/:id` | Delete a note |
| `GET` | `/health` | Database check with a 2-second timeout (`200` or `503`). Used by the gateway; not exposed publicly |

Request bodies are limited to 1 MB.

---

## How it works

### Ownership

The owner always comes from the verified token's `sub` claim, never from the request. Every query in [`notes.service.ts`](src/services/notes.service.ts) filters on `user_id`, and update and delete check ownership in the same statement as the write (`UPDATE/DELETE … WHERE id = ? AND user_id = ?`), so there's no gap between the check and the change.

Another user's note, an unknown id and a malformed id (not a UUID v4) all return the same `404 Note not found`, so note ids can't be probed.

### Listing and pagination

Notes are sorted by `isPinned DESC, updatedAt DESC, id DESC`; the id makes the order total. A composite index on `(user_id, is_pinned, updated_at, id)` matches it.

Pagination is keyset-based. `nextCursor` is the base64url-encoded sort position of the last note on the page (`{"p": isPinned, "u": updatedAt, "i": id}`), and the next page asks for notes strictly after it. Unlike offsets, the position doesn't shift when notes are created, edited or deleted between requests, so untouched notes are never skipped or repeated. A note edited mid-way moves to the top and won't reappear on later pages. The service fetches `limit + 1` rows to know whether there's another page; `nextCursor` is `null` on the last one. A cursor that can't be decoded returns `400 Invalid cursor`.

`?q=` is a case-insensitive `ILIKE` match on title and content; `?pinned=true|false` filters.

### Validation

[`validation.ts`](src/validation.ts) (Joi). Unknown fields such as `userId`, `id` or `createdAt` are stripped.

| Field | Rules |
|---|---|
| `title` | Required on create. 1–200 characters after trimming |
| `content` | Up to 100,000 characters; default `""` |
| `isPinned` | Boolean (strict: `"true"` as a string is rejected); default `false` |
| `PATCH` body | At least one of the three fields |
| `limit` | Integer 1–100, default 20 |
| `cursor` | Up to 500 characters |
| `q` | 1–200 characters after trimming |
| `pinned` | `true` or `false` |

---

## Database schema

[`prisma/schema.prisma`](prisma/schema.prisma), migrations in [`prisma/migrations/`](prisma/migrations):

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

## Configuration

Read from the environment (or `.env`, see [`.env.example`](.env.example)) and validated at startup by [`config.ts`](src/config.ts).

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | `postgres://` or `postgresql://` connection string for the notes database |
| `JWT_ACCESS_SECRET` | ✅ | — | **Must equal auth-service's value.** Used to verify access tokens. Minimum 32 characters |
| `JWT_ISSUER` | | `notepad-auth-service` | **Must equal auth-service's value** |
| `PORT` | | `3002` | HTTP port |
| `HOST` | | all interfaces | Interface to bind. In production use `127.0.0.1` or a private address so only the gateway can reach it |
| `NODE_ENV` | | `development` | `development`, `test` or `production` (hides error details) |

If the secret or issuer differ from auth-service's, every request returns `401`.

---

## Running

From the repository root, with PostgreSQL running (see [Getting started](../../README.md#getting-started)):

```bash
cp services/notes-service/.env.example services/notes-service/.env   # set DATABASE_URL and JWT_ACCESS_SECRET
npm run db:deploy -w notes-service
npm run dev:notes
```

To get a token, run auth-service too (`npm run dev` starts everything).

| Script | Description |
|---|---|
| `npm run dev` | Start with live reload (`tsx watch`) |
| `npm run build` | Generate the Prisma client and compile to `dist/` |
| `npm start` | Run the compiled build |
| `npm run typecheck` | Type-check without emitting |
| `npm run db:migrate` | Create and apply a migration in development |
| `npm run db:deploy` | Apply pending migrations (production/CI) |
| `npm run db:generate` | Regenerate the Prisma client into `src/generated/prisma/` (gitignored) |
| `npm run db:studio` | Browse the data in Prisma Studio |

Run them from the root with `-w notes-service`.

---

## Tests

```bash
npx jest --selectProjects notes-service                 # unit: validation schemas
npx jest --selectProjects notes-service:integration     # needs PostgreSQL
```

Integration tests create and migrate `notepad_notes_test` on `TEST_POSTGRES_URL` (default `postgresql://postgres:postgres@localhost:5432`) and sign their own access tokens with the test secret. They cover CRUD, validation, ownership isolation between users, search, filters and cursor pagination. See [Testing](../../README.md#testing) for details.

---

## Trade-offs

The design trade-offs of this service, and what would replace them, are listed in the root README under [Design trade-offs and next steps](../../README.md#design-trade-offs-and-next-steps).
