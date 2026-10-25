# auth-service

Accounts and the token lifecycle for [notepad-api](../../README.md): registration, login, refresh-token rotation, logout and "current user". It issues the JWT access tokens that every other service verifies locally.

- **Port:** `3001` (internal; clients reach it through the gateway at `/api/v1/auth/*`)
- **Database:** `notepad_auth` (PostgreSQL, Prisma)
- **API contract:** [`docs/openapi.yaml`](../../docs/openapi.yaml) · examples in the [root API reference](../../README.md#auth-service-endpoints)

---

## Endpoints

Paths are as the service sees them; the gateway serves them under `/api/v1`.

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/register` | — | Create an account; returns the user and a token pair (`201`) |
| `POST` | `/auth/login` | — | Log in; returns the user and a token pair |
| `POST` | `/auth/refresh` | — | Revoke the given refresh token and issue a new pair |
| `POST` | `/auth/logout` | — | Revoke a refresh token (idempotent) |
| `POST` | `/auth/logout-all` | Bearer | Revoke every refresh token of the caller ("log out of all devices") |
| `GET` | `/auth/me` | Bearer | The current user |
| `GET` | `/health` | — | Database check with a 2-second timeout (`200` or `503`). Used by the gateway; not exposed publicly |

Request bodies are limited to 100 KB.

---

## How it works

### Tokens

| Token | Format | Lifetime | Stored as |
|---|---|---|---|
| Access | JWT, HS256, `sub` = user id, `email`, `iss` = `JWT_ISSUER` | `ACCESS_TOKEN_TTL_SECONDS` (15 min) | Not stored |
| Refresh | 32 random bytes, base64url | `REFRESH_TOKEN_TTL_DAYS` (7 days) | SHA-256 hash in `refresh_tokens` |

**Rotation.** [`refresh()`](src/services/auth.service.ts) revokes the presented token with a conditional `UPDATE … WHERE revoked_at IS NULL` and issues a new pair. Of two concurrent refreshes with the same token, only one can succeed.

**Reuse detection.** Presenting a token that's already revoked means it was stolen or replayed, so every session of that user is revoked. The loser of a concurrent refresh race is treated the same way.

**Logout** revokes the presented refresh token; **logout-all** revokes every refresh token of the caller. In both cases access tokens already issued stay valid until they expire.

**Cleanup.** [`utils/tokenCleanup.ts`](src/utils/tokenCleanup.ts) runs at startup and every `REFRESH_TOKEN_CLEANUP_INTERVAL_MINUTES` (60), deleting refresh tokens past their expiry. Revoked tokens are kept until they expire, because reuse detection needs them to recognise a replay; once expired, a token is rejected anyway. The delete is idempotent, so running several instances is safe. Failures are logged and retried on the next run.

### Passwords

[`utils/password.ts`](src/utils/password.ts) uses Node's built-in `crypto.scrypt` (N=2¹⁵, r=8, p=3, 16-byte salt, 64-byte key). Hashes are stored as `scrypt$N$r$p$salt$hash`, so the parameters can be raised later without invalidating existing passwords. Comparison uses `timingSafeEqual`.

Logins for unknown emails hash against a dummy value, so they take as long as wrong-password logins and return the same `401 Invalid email or password`.

### Per-account lockout

[`utils/loginThrottle.ts`](src/utils/loginThrottle.ts) counts failed logins per normalised email, from any IP. After `LOGIN_MAX_FAILURES` (10) in `LOGIN_LOCKOUT_WINDOW_MINUTES` (15), logins for that email get `429` with `Retry-After` until the window ends. A successful login clears the count. Unknown emails are counted the same way, so a lockout never reveals whether an account exists.

This complements the gateway's per-IP login limit, which can't stop credential stuffing spread across many IPs.

### Validation

[`validation.ts`](src/validation.ts) (Joi). Unknown fields are stripped.

| Field | Rules |
|---|---|
| `email` | Valid email, at most 254 characters; trimmed and lowercased |
| `password` (register) | 8–128 characters, at least one uppercase letter, one lowercase letter and one number |
| `password` (login) | Required, at most 128 characters (the cap stops very long inputs from wasting CPU on hashing) |
| `refreshToken` | Required string |

---

## Database schema

[`prisma/schema.prisma`](prisma/schema.prisma), migrations in [`prisma/migrations/`](prisma/migrations):

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

The password hash is never selected into a response.

---

## Configuration

Read from the environment (or `.env`, see [`.env.example`](.env.example)) and validated at startup by [`config.ts`](src/config.ts). The service refuses to start if anything is missing or invalid.

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | `postgres://` or `postgresql://` connection string. Prisma's `prisma+postgres://` URLs aren't supported by the driver adapter |
| `JWT_ACCESS_SECRET` | ✅ | — | HMAC secret for signing access tokens. Minimum 32 characters (`openssl rand -base64 48`). **notes-service must use the same value** |
| `JWT_ISSUER` | | `notepad-auth-service` | `iss` claim on access tokens. **notes-service must use the same value** |
| `ACCESS_TOKEN_TTL_SECONDS` | | `900` (15 min) | Access token lifetime. Minimum 60 |
| `REFRESH_TOKEN_TTL_DAYS` | | `7` | Refresh token lifetime. Minimum 1 |
| `REFRESH_TOKEN_CLEANUP_INTERVAL_MINUTES` | | `60` | How often expired refresh tokens are deleted. Minimum 1 |
| `LOGIN_MAX_FAILURES` | | `10` | Failed logins allowed per email before it's locked out |
| `LOGIN_LOCKOUT_WINDOW_MINUTES` | | `15` | Lockout window |
| `PORT` | | `3001` | HTTP port |
| `HOST` | | all interfaces | Interface to bind. In production use `127.0.0.1` or a private address so only the gateway can reach it |
| `NODE_ENV` | | `development` | `development`, `test` or `production` (hides error details) |

---

## Running

From the repository root, with PostgreSQL running (see [Getting started](../../README.md#getting-started)):

```bash
cp services/auth-service/.env.example services/auth-service/.env   # set DATABASE_URL and JWT_ACCESS_SECRET
npm run db:deploy -w auth-service
npm run dev:auth
```

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

Run them from the root with `-w auth-service`.

---

## Tests

```bash
npx jest --selectProjects auth-service                 # unit: passwords, tokens, lockout, cleanup schedule, validation
npx jest --selectProjects auth-service:integration     # needs PostgreSQL
```

Integration tests create and migrate `notepad_auth_test` on `TEST_POSTGRES_URL` (default `postgresql://postgres:postgres@localhost:5432`) and cover register, login, lockout, refresh rotation and replay detection, logout, logout-all, expired-token cleanup and `/me`. [`test/setup-env.ts`](test/setup-env.ts) sets every variable the config reads, so a local `.env` doesn't affect results, and lowers `LOGIN_MAX_FAILURES` to 3. See [Testing](../../README.md#testing) for details.

---

## Trade-offs

The design trade-offs of this service, and what would replace them, are listed in the root README under [Design trade-offs and next steps](../../README.md#design-trade-offs-and-next-steps).
