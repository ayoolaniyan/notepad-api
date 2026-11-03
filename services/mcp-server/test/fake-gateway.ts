import { randomUUID } from "node:crypto";
import type { FetchFn } from "../src/http";

// In-memory stand-in for the gateway, for unit tests. It mimics the parts of the real API the MCP
// server depends on: the response envelope, login, refresh-token rotation with reuse detection,
// Bearer checks and a minimal notes CRUD.

export const FAKE_PASSWORD = "placeholder-password";

interface FakeNote {
    id: string;
    title: string;
    content: string;
    isPinned: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface Received {
    method: string;
    path: string;
    search: string;
    body: unknown;
    authorization: string | null;
}

type Override = (req: Received) => Response | undefined | Promise<Response | undefined>;

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

export function createFakeGateway() {
    let counter = 0;
    const state = {
        requests: [] as Received[],
        logins: 0,
        // Every refresh token presented to /auth/refresh, in order
        refreshTokensUsed: [] as string[],
        reuseDetected: false,
        liveAccessTokens: new Set<string>(),
        liveRefreshTokens: new Set<string>(),
        revokedRefreshTokens: new Set<string>(),
        notes: new Map<string, FakeNote>(),
        expiresIn: 900,
        // Lets a test intercept any request (return undefined to fall through to the fake)
        override: undefined as Override | undefined,
    };

    const issue = () => {
        counter += 1;
        const accessToken = `access-${counter}`;
        const refreshToken = `refresh-${counter}`;
        state.liveAccessTokens.add(accessToken);
        state.liveRefreshTokens.add(refreshToken);
        return json(200, {
            success: true,
            data: { accessToken, refreshToken, tokenType: "Bearer", expiresIn: state.expiresIn },
        });
    };

    const handle = (req: Received): Response => {
        const { method, path } = req;
        const body = (req.body ?? {}) as Record<string, unknown>;

        if (method === "POST" && path === "/api/v1/auth/login") {
            state.logins += 1;
            return body["password"] === FAKE_PASSWORD
                ? issue()
                : json(401, { success: false, error: "Invalid email or password" });
        }
        if (method === "POST" && path === "/api/v1/auth/refresh") {
            const token = String(body["refreshToken"]);
            state.refreshTokensUsed.push(token);
            if (state.revokedRefreshTokens.has(token)) {
                state.reuseDetected = true;
                return json(401, { success: false, error: "Invalid refresh token" });
            }
            if (!state.liveRefreshTokens.delete(token)) {
                return json(401, { success: false, error: "Invalid refresh token" });
            }
            state.revokedRefreshTokens.add(token);
            return issue();
        }
        if (method === "POST" && path === "/api/v1/auth/logout") {
            const token = String(body["refreshToken"]);
            if (state.liveRefreshTokens.delete(token)) state.revokedRefreshTokens.add(token);
            return json(200, { success: true, message: "Logged out" });
        }

        const token = req.authorization?.replace(/^Bearer /, "");
        if (!token || !state.liveAccessTokens.has(token)) {
            return json(401, { success: false, error: "Invalid or expired access token" });
        }

        const now = new Date().toISOString();
        const match = /^\/api\/v1\/notes(?:\/([^/?]+))?$/.exec(path);
        if (!match) return json(404, { success: false, error: `Route ${method} ${path} not found` });
        const id = match[1];

        if (!id && method === "GET") {
            return json(200, { success: true, data: { notes: [...state.notes.values()], nextCursor: null } });
        }
        if (!id && method === "POST") {
            const note: FakeNote = {
                id: randomUUID(),
                title: String(body["title"]),
                content: typeof body["content"] === "string" ? body["content"] : "",
                isPinned: body["isPinned"] === true,
                createdAt: now,
                updatedAt: now,
            };
            state.notes.set(note.id, note);
            return json(201, { success: true, data: { note }, message: "Note created" });
        }
        const note = id ? state.notes.get(id) : undefined;
        if (!note) return json(404, { success: false, error: "Note not found" });
        if (method === "GET") return json(200, { success: true, data: { note } });
        if (method === "PATCH") {
            Object.assign(note, body, { updatedAt: now });
            return json(200, { success: true, data: { note }, message: "Note updated" });
        }
        if (method === "DELETE") {
            state.notes.delete(note.id);
            return json(200, { success: true, message: "Note deleted" });
        }
        return json(404, { success: false, error: `Route ${method} ${path} not found` });
    };

    const fetch: FetchFn = async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        const headers = new Headers(init?.headers);
        const req: Received = {
            method: init?.method ?? "GET",
            path: url.pathname,
            search: url.search,
            body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
            authorization: headers.get("authorization"),
        };
        state.requests.push(req);
        // Yield like a real network call, so concurrent callers interleave
        await new Promise((resolve) => setImmediate(resolve));
        return (await state.override?.(req)) ?? handle(req);
    };

    // Simulates every outstanding access token expiring
    const expireAccessTokens = () => state.liveAccessTokens.clear();

    return { fetch, state, expireAccessTokens };
}
