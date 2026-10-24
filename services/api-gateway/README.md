# api-gateway

The only public entry point of [notepad-api](../../README.md). It routes requests to the internal services and applies the cross-cutting HTTP policy: rate limiting, CORS, security headers, request ids and access logs.

The gateway has no database, doesn't parse request bodies and doesn't hold the JWT secret. It never verifies tokens; each service does that itself.

- **Port:** `3000` (public)
- **Upstreams:** auth-service (`:3001`), notes-service (`:3002`)
- **API contract:** [`docs/openapi.yaml`](../../docs/openapi.yaml)

---

## Routes

| Gateway path | Forwarded to |
|---|---|
| `/api/v1/auth/*` | auth-service `/auth/*` (every response gets `Cache-Control: no-store`) |
| `/api/v1/notes/*` | notes-service `/notes/*` |
| `GET /health` | Answered by the gateway: aggregated health of every service |
| anything else | `404` from the gateway; never reaches a service |

Bodies are streamed, not parsed, and query strings are passed through unchanged. Express strips the mount path and [`proxy.ts`](src/proxy.ts) adds the service's prefix, so `/api/v1/notes/abc?x=1` reaches notes-service as `/notes/abc?x=1`.

| Upstream problem | Response |
|---|---|
| Connection refused, reset, DNS failure | `502` `Service unavailable` |
| No answer within `UPSTREAM_TIMEOUT_MS` | `504` `Service timed out` |
| Failure after the response has started | Connection is cut (the status was already sent) |

Both use the standard error envelope and are logged with the service name and request id.

### `GET /health`

Calls every service's own `GET /health` in parallel, each with a 2-second timeout.

```json
{ "success": true, "data": { "service": "api-gateway", "status": "ok", "upstreams": { "auth": "ok", "notes": "ok" } } }
```

Returns `200` when every service reports healthy, otherwise `503` with `"success": false`, `"status": "degraded"` and `"down"` for each failing service. Not rate limited, so load balancers can poll it.

---

## Request pipeline

Defined in [`app.ts`](src/app.ts):

```
request → X-Request-Id → access log → security headers → CORS → /health?
        → global rate limit → body size check → route rate limit → proxy → service
```

CORS comes before rate limiting, so preflights aren't counted and `429` responses still carry CORS headers a browser can read.

### Request ids

Every request gets an `X-Request-Id`, which is forwarded to the service and returned to the client. A client-supplied id is kept if it is 8–128 characters of `A-Z a-z 0-9 . _ -`; anything else is replaced with a random UUID, so the header is always safe to log.

### Rate limits

Per client IP, per gateway instance ([`middleware/rateLimits.ts`](src/middleware/rateLimits.ts)):

| Route | Default | Notes |
|---|---|---|
| Everything | 300 / minute | |
| `POST /api/v1/auth/login` | **5 failed attempts / 15 minutes** | Successful logins don't count. Once the limit is hit, every login from that IP is blocked until the window resets |
| `POST /api/v1/auth/register` | 5 / hour | |
| `POST /api/v1/auth/refresh` | 30 / minute | |
| `GET /health` | not limited | |

Responses include `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` and `RateLimit-Policy` headers (IETF draft 6); a `429` also includes `Retry-After` (seconds). Route matching is case-insensitive and ignores a trailing slash, so `/auth/LOGIN` and `/auth/login/` are limited too.

On top of this, auth-service locks out **an account** after 10 failed logins in 15 minutes, whatever IP they come from.

The client IP comes from `TRUST_PROXY`: with `0` it's the socket address, with `n` it's the `n`th address from the right of `X-Forwarded-For`. Set it to the number of load balancers in front of the gateway. Too high lets clients fake their IP; too low puts every client behind the load balancer's IP.

### Body size

Requests whose `Content-Length` exceeds `MAX_BODY_BYTES` (1 MB) get `413` before any service is contacted. Each service also enforces its own limit (auth 100 KB, notes 1 MB), which covers chunked uploads that don't send `Content-Length`.

### CORS

- Only origins listed in `CORS_ORIGINS` get CORS headers. Others are not rejected by the gateway, but browsers block the response.
- Allowed methods: `GET`, `POST`, `PATCH`, `DELETE`. Allowed headers: `Authorization`, `Content-Type`, `X-Request-Id`.
- No credentials mode: tokens are sent in the `Authorization` header, not cookies.
- Browser code can read `X-Request-Id`, `RateLimit-*` and `Retry-After`. Preflights are cached for 10 minutes.

### Security headers

Set with `helmet`, tuned for a JSON API ([`middleware/security.ts`](src/middleware/security.ts)):

| Header | Value |
|---|---|
| `Content-Security-Policy` | `default-src 'none'; frame-ancestors 'none'` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |
| `Cross-Origin-Resource-Policy` | `same-site` |
| `Strict-Transport-Security` | `max-age=15552000; includeSubDomains` (**production only**) |
| `Cache-Control` | `no-store` on every `/api/v1/auth/*` response |

`X-Powered-By` is removed, including from service responses.

### Logging

One JSON line per request (`pino-http`): method, path (no query string), status, duration, client address and request id. `Authorization` headers, cookies and bodies are never logged.

---

## Configuration

Read from the environment (or `.env`, see [`.env.example`](.env.example)) and validated at startup by [`config.ts`](src/config.ts). The gateway refuses to start if a value is invalid.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Public HTTP port |
| `HOST` | all interfaces | Interface to bind |
| `AUTH_SERVICE_URL` | `http://localhost:3001` | Internal address of auth-service |
| `NOTES_SERVICE_URL` | `http://localhost:3002` | Internal address of notes-service |
| `UPSTREAM_TIMEOUT_MS` | `10000` | After this, the gateway gives up on a service and returns `504`. Minimum 100 |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allowed front-end origins. `*` is rejected |
| `TRUST_PROXY` | `0` | Number of load balancers in front of the gateway (see [Rate limits](#rate-limits)) |
| `MAX_BODY_BYTES` | `1048576` (1 MB) | Larger requests are rejected with `413`. Minimum 1024 |
| `RATE_LIMIT_<NAME>_MAX` | see [Rate limits](#rate-limits) | Requests allowed per window. `NAME` is `GLOBAL`, `LOGIN`, `REGISTER` or `REFRESH` |
| `RATE_LIMIT_<NAME>_WINDOW_MS` | see [Rate limits](#rate-limits) | Window length in milliseconds. Minimum 1000 |
| `NODE_ENV` | `development` | `production` turns on HSTS and hides error details |

---

## Running

From the repository root:

```bash
cp services/api-gateway/.env.example services/api-gateway/.env
npm run dev:gateway       # gateway only, with live reload
npm run dev               # gateway plus both services
```

The defaults point at the services on `localhost`, so nothing needs changing locally except `CORS_ORIGINS` if you have a front end.

| Script | Description |
|---|---|
| `npm run dev` | Start with live reload (`tsx watch`) |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run the compiled build |
| `npm run typecheck` | Type-check without emitting |

Run them from the root with `-w api-gateway`, e.g. `npm run build -w api-gateway`.

---

## Tests

```bash
npx jest --selectProjects api-gateway
```

The tests start fake upstream servers on random ports, so no database or real service is needed. They cover routing and path rewriting, request ids, security headers, CORS, `413`/`502`/`504`, health and every rate limit, including bypass attempts (case, trailing slash, spoofed `X-Forwarded-For`). Each scenario loads a fresh copy of the app, so rate-limit counters start at zero.

---

## Limitations

- **Rate-limit counters live in memory**, per instance, and reset on restart. Several instances need a shared store (`rate-limit-redis`).
- **The body-size check relies on `Content-Length`.** Chunked uploads skip it; the services' own limits still apply.
- **Docker Desktop hides client IPs.** On macOS and Windows, all requests to the published port appear to come from one address, so every client shares the per-IP limits. Linux hosts keep real client IPs.
