# @notepad/shared

Shared types, HTTP helpers and JWT verification for the [notepad-api](../README.md) services, so every service shapes responses, handles errors and checks tokens the same way.

It's an npm workspace package compiled to `dist/` with type declarations. It reads no environment variables: services pass their own settings in.

---

## Using it

A service adds `"@notepad/shared": "*"` to its dependencies and runs `npm install` at the repository root, which links the workspace.

```ts
import express from "express";
import { createErrorHandler, createRequireAuth, notFoundHandler, ok, validateBody } from "@notepad/shared";

const requireAuth = createRequireAuth({ secret: process.env.JWT_ACCESS_SECRET!, issuer: "notepad-auth-service" });

const app = express();
app.use(express.json());
app.get("/notes", requireAuth, (req, res) => {
    res.json(ok({ owner: req.user!.id })); // req.user is typed
});
app.use(notFoundHandler);
app.use(createErrorHandler({ exposeDetails: process.env.NODE_ENV !== "production" }));
```

`express`, `joi` and `jsonwebtoken` are **peer dependencies**, so each service provides them. This keeps a single copy of Express, which the `req.user` typing depends on.

---

## Exports

### Types

| Export | Description |
|---|---|
| `ApiResponse<T>` | The response envelope: `success`, `data?`, `message?`, `error?`, `errors?` |
| `User` | `id`, `email`, `createdAt`, `updatedAt` |
| `AuthUser` | The caller attached to `req.user`: `id`, `email` |
| `AccessTokenPayload` | Access token claims: `sub` (user id), `email` |

Importing the package also augments Express's `Request` with `user?: AuthUser`.

### HTTP

| Export | Description |
|---|---|
| `ok(data?, message?)` / `fail(error, errors?)` | Build the standard success and error envelopes |
| `AppError(status, message, errors?, headers?)` | Throw from anywhere; the error handler turns it into a JSON response, with any extra headers (e.g. `Retry-After`) |
| `notFoundHandler` | JSON `404` for unmatched routes (`Route GET /x not found`) |
| `createErrorHandler({ exposeDetails, log? })` | Central error handler: `AppError` → its status; malformed JSON and oversized bodies → `400`/`413`; anything else → `500`, with the message hidden unless `exposeDetails` |
| `validateBody(schema)` / `validateQuery(schema)` | Validate `req.body` / `req.query` with a Joi schema, strip unknown fields and replace the input with the sanitised value. Failures throw `400 Validation failed` with every message grouped by field |
| `createHealthHandler({ service, checkDatabase, timeoutMs? })` | `GET /health` handler: `200` when `checkDatabase()` resolves within `timeoutMs` (2 seconds), `503` otherwise. Never hangs |
| `startServer(app, { name, port, host?, nodeEnv, onShutdown?, forceExitAfterMs? })` | Listen (optionally on one interface), exit with an error if the port is taken, and on `SIGINT`/`SIGTERM` stop accepting connections, run `onShutdown`, and force-exit after 10 seconds |

### Auth

| Export | Description |
|---|---|
| `ACCESS_TOKEN_ALGORITHM` | `"HS256"`, the only algorithm access tokens may use. auth-service signs with it |
| `verifyAccessToken(token, { secret, issuer })` | Verify signature, expiry, algorithm and issuer and return the claims. Rejects `alg=none`, other algorithms, other issuers and payloads without `sub` and `email` |
| `createRequireAuth({ secret, issuer })` | Middleware that requires `Authorization: Bearer <token>`, sets `req.user`, and otherwise responds `401` |

---

## Development

```bash
npm run build -w @notepad/shared    # compile src/ to dist/
npm run dev -w @notepad/shared      # recompile on change
npx jest --selectProjects shared    # unit tests
```

Services import the compiled `dist/`, so **build this package before compiling or type-checking a service**. The root `build`, `typecheck` and `dev*` scripts do this first, and in `npm run dev` changes here rebuild and restart the services automatically.

`tsconfig.json` type-checks sources and tests; `tsconfig.build.json` compiles `src/` only, excluding tests.
