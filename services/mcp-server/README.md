# mcp-server

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets an AI agent (Claude Desktop, Claude Code or any MCP client) read and manage one user's notes in notepad-api.

It is a thin client of the **public gateway**: every call goes over HTTP to `NOTEPAD_API_URL` (`/api/v1/...`), signed in as the configured account. It never imports service code or touches a database, so it has exactly the permissions of that account and nothing more.

- Transport: **stdio** only (the client starts the process and talks over stdin/stdout)
- Built with the official [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) (1.32) and `zod` schemas
- Source: `src/config.ts` (env), `src/http.ts` (gateway client), `src/auth.ts` (token handling), `src/tools.ts` (tool definitions), `src/server.ts`, `src/index.ts`

## Setup

You need a running gateway (see the [root README](../../README.md#getting-started)) and an account on it.

```bash
npm install                  # from the repo root
npm run build -w mcp-server  # writes services/mcp-server/dist/
```

Register an account if you don't have one (any client works; this uses the gateway directly):

```bash
curl -s -X POST http://localhost:3000/api/v1/auth/register -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"<YOUR_PASSWORD>"}' > /dev/null
```

### Configuration

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `NOTEPAD_API_URL` | no | `http://localhost:3000` | Gateway base URL, without `/api/v1` |
| `NOTEPAD_EMAIL` | yes | — | Account email |
| `NOTEPAD_PASSWORD` | yes | — | Account password |

The server validates these at startup and exits with code 1 if one is missing or malformed. The message names the variable and the problem, never its value. [`.env.example`](.env.example) lists them. The server does **not** read `.env` files itself: the MCP client passes the variables (see below).

### Client configuration

Claude Desktop (`claude_desktop_config.json`) and Claude Code (`.mcp.json` in a project, or `claude mcp add`) both use this shape. Use an absolute path, and keep real credentials out of version control:

```json
{
  "mcpServers": {
    "notepad": {
      "command": "node",
      "args": ["/absolute/path/to/notepad-api/services/mcp-server/dist/index.js"],
      "env": {
        "NOTEPAD_API_URL": "http://localhost:3000",
        "NOTEPAD_EMAIL": "you@example.com",
        "NOTEPAD_PASSWORD": "<YOUR_PASSWORD>"
      }
    }
  }
}
```

With Claude Code you can also run:

```bash
claude mcp add notepad -e NOTEPAD_EMAIL=you@example.com -e NOTEPAD_PASSWORD='<YOUR_PASSWORD>' \
  -- node /absolute/path/to/notepad-api/services/mcp-server/dist/index.js
```

### Docker

The repo's Dockerfile builds this package like the services (`--build-arg SERVICE=mcp-server`). It is not part of `docker-compose.yml`, because an MCP client starts it on demand. Run it with `-i` so stdin stays open:

```bash
docker build --build-arg SERVICE=mcp-server -t notepad/mcp-server .
docker run -i --rm -e NOTEPAD_API_URL=http://host.docker.internal:3000 \
  -e NOTEPAD_EMAIL=you@example.com -e NOTEPAD_PASSWORD='<YOUR_PASSWORD>' notepad/mcp-server
```

`host.docker.internal` resolves on Docker Desktop. On Linux, add `--add-host=host.docker.internal:host-gateway`.

## Tools

| Tool | Inputs | Returns | Annotations |
|---|---|---|---|
| `list_notes` | `limit` (1-100, default 20), `cursor`, `query` (1-200 chars, substring match on title or content), `pinned` | `{ notes, nextCursor }`. Each note's `content` is cut to a **300-character preview**, with `contentTruncated` | read-only |
| `get_note` | `id` (UUID) | `{ note }` with full content | read-only |
| `create_note` | `title` (1-200 chars, trimmed), `content` (≤ 100,000 chars, default `""`), `isPinned` (default `false`) | `{ note }` | not idempotent |
| `update_note` | `id` plus at least one of `title`, `content`, `isPinned` | `{ note }` | destructive (overwrites fields), not idempotent |
| `delete_note` | `id` | `{ deleted: true, id }` | destructive, idempotent |

Every tool returns `structuredContent` (matching its declared `outputSchema`) and a short text rendering for clients that only read text. List order is the API's: pinned first, then most recently updated.

**Why a 300-character preview.** Content can be up to 100,000 characters and a page up to 100 notes, so one untruncated `list_notes` call could return 10M characters and fill an agent's context window. At 300 characters a full page stays around 50k characters, even with 200-character titles. The descriptions tell the model to call `get_note` for the full text.

**Why these annotations.** `update_note` isn't idempotent: every update bumps `updatedAt`, which moves the note in the list order. `delete_note` is idempotent in effect (a repeat changes nothing), although the repeat returns a not-found error.

### Errors

Failures come back as tool results with `isError: true` and a message the model can act on, never as protocol errors or stack traces. Examples (exact strings from `src/tools.ts`):

| Situation | Message |
|---|---|
| Unknown, deleted or another user's note (the API answers 404 for all three) | `Note not found. The id may be wrong or the note was deleted; call list_notes to find valid ids.` |
| Validation failure from the API (`400`, field errors flattened) | `Validation failed: title: Title cannot be empty.` |
| Bad cursor | `Invalid cursor. Pass the nextCursor from the previous list_notes result unchanged, or omit it to start again.` |
| Rate limit (`429`, uses `Retry-After`) | `Rate limited by the gateway; retry after 12 seconds.` |
| No answer within 10 s | `No response from notepad-api within 10 seconds. A create or update may still have been applied: check with list_notes or get_note before retrying.` |
| Gateway down | `Could not reach notepad-api at http://localhost:3000 (ECONNREFUSED). Check that the notepad-api gateway is running.` |
| Wrong credentials | `Login failed: notepad-api rejected NOTEPAD_EMAIL/NOTEPAD_PASSWORD. Fix the credentials and restart the MCP server.` |

Inputs are also validated locally against the same limits as notes-service, so most mistakes are caught before a request is sent.

## How authentication works

auth-service issues a 15-minute access token and a refresh token that **rotates on every use**. Presenting an already-used refresh token is treated as theft and revokes every session of the user. The server is built around that:

- **Lazy login.** The first tool call logs in. Tokens live in memory only and are never logged or returned.
- **Single-flight renewal.** At most one login or refresh runs at a time, and concurrent calls wait for it. A refresh token is sent at most once, so a burst of parallel tool calls can't trigger reuse detection.
- **Proactive refresh.** The token is refreshed 30 seconds before `expiresIn` runs out.
- **401 handling.** On a 401 it refreshes once and retries once. If the refresh token is rejected (expired after 7 days, or revoked by "log out of all devices"), it logs in once more. If that also fails, the call returns an auth error. Nothing loops.
- **Login lockout protection.** If the password is rejected, the server stops trying until it's restarted. Repeated attempts would only count towards auth-service's per-account lockout (10 failures in 15 minutes).
- **No automatic retries** for 429, 5xx or timeouts. The error says when to retry, and a timed-out create may already have been applied.
- **Logout on exit.** On SIGINT, SIGTERM or stdin closing, the server revokes its refresh token (best effort).

## Security notes

- Credentials come from the environment only. Anyone who can read the client's MCP config can read the password, so treat that file like a secret.
- The server can do anything the configured account can do with notes, including permanent deletion. Clients that honour `destructiveHint` can ask for confirmation before `update_note` and `delete_note`.
- Notes are scoped by the access token on the server side (notes-service filters every query by the token's `sub`). This server can't reach another user's notes, and the integration tests check that.
- Note content is user data. An agent should treat text it reads from notes as data, not instructions.

## Limitations

- **One account per server process.** For several users, run several instances with different credentials.
- **stdio only.** Streamable HTTP is left out on purpose: the server holds one account's password, so exposing it over HTTP would need its own authentication layer.
- **Tools only.** No MCP resources, prompts, subscriptions or change notifications, and results aren't streamed.
- **Shared rate limits.** The gateway limits per client IP: 300 requests per minute overall, 30 refreshes per minute, and 5 failed logins per 15 minutes. Several MCP servers on one machine share those budgets.
- **Revocation lag.** An access token stays valid for up to 15 minutes after logout. If the process is killed without a clean exit (e.g. SIGKILL), its refresh token stays valid until it expires (7 days).
- **Search is a substring match** (`ILIKE`), not full-text search.
- **No retry after timeouts.** A request that times out may or may not have been applied; the agent has to check.

## Tests and evals

| Command | What it does | Needs |
|---|---|---|
| `npx jest --selectProjects mcp-server` | Unit tests against an in-memory fake gateway: auth manager (lazy login, single-flight refresh under concurrency, retry once, fallback to login, no loops, 429, timeout), input validation, error mapping, truncation, config | Nothing |
| `npx jest --selectProjects mcp-server:integration` | Tools end to end against real auth-service, notes-service and gateway processes: CRUD, search, pinned filter, cursor pagination, not-found, isolation between two users | PostgreSQL (`TEST_POSTGRES_URL`) |
| `npm run evals -w mcp-server` | Deterministic tool-contract evals (below) | PostgreSQL |
| `npm run evals:agent -w mcp-server` | Optional agent evals (below) | PostgreSQL and `ANTHROPIC_API_KEY` |

The integration tests and evals start the three services from source as child processes on random ports. They use their own databases, `notepad_mcp_auth_test` and `notepad_mcp_notes_test`, which are wiped on every run (names must end in `_test`). They build `@notepad/shared` if needed, and need the Prisma clients to be generated (`npm run build` does both).

### What the evals measure

**Deterministic evals** (`evals/scenarios.ts`, run in CI) script multi-step workflows through the MCP tools. Each scenario gets a fresh user, and each is graded on the **final state read from the REST API**, not on tool text:

1. Create three notes, pin one, find it by search, update another, delete the third.
2. Page through 45 notes at `limit: 20`: exactly 3 pages, no gaps, no duplicates.
3. A missing id: `get`, `update` and `delete` all return an actionable `isError`, and nothing changes.
4. The access token expires mid-scenario. An expired but correctly signed JWT is swapped in, the real notes-service answers 401, and the server recovers with exactly one refresh and no extra login.
5. Five concurrent calls hit an expired token: they share one refresh, and a later call proves reuse detection never fired.

These check the **tool contract**: that the tools do what their descriptions say, recover from token expiry, and report errors usefully. They say nothing about whether a model will choose the right tools.

**Agent evals** (`evals/agent.ts`, off by default) give a Claude model (`EVAL_MODEL`, default `claude-opus-5-5`) a natural-language task over a seeded set of notes, such as "Pin all my notes that mention 'invoice' and delete the ones titled 'scratch'". The model calls the MCP tools in a simple loop, and the run is graded on the final state of the notes. Per task they record pass/fail, tool calls, tool errors and turns, and write them to `evals/results/agent-<timestamp>.json` (git-ignored). Each run calls the Claude API and costs money.

```bash
ANTHROPIC_API_KEY=... TEST_POSTGRES_URL=postgresql://postgres:<POSTGRES_PASSWORD>@localhost:5432 \
  npm run evals:agent -w mcp-server
```

What the agent evals do **not** tell you: there are only four tasks, each run once, so a single run isn't a reliable success rate. The results depend on the model and its sampling, and there's no human or LLM judging of the model's replies. No agent-eval results are published in this repository.
