import jwt from "jsonwebtoken";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { FetchFn } from "../src/http";
import { allNotes, connectAgent, registerUser, RestNote, TestUser } from "../test/harness";
import { STACK_JWT_ISSUER, STACK_JWT_SECRET } from "../test/stack";

// Deterministic tool-contract evals: scripted multi-step scenarios run through the MCP tools
// against the real stack. Each scenario gets a fresh user. Grading reads the final state from the
// REST API directly (not from tool output), so a tool that reports success without doing the
// work still fails.

export interface ScenarioResult {
    pass: boolean;
    detail: string;
    toolCalls: number;
    toolErrors: number;
}

export interface Scenario {
    name: string;
    run: (gatewayUrl: string) => Promise<ScenarioResult>;
}

type Note = RestNote & { id: string };
const note = (r: CallToolResult) => (r.structuredContent as { note: Note }).note;
const page = (r: CallToolResult) => r.structuredContent as { notes: Note[]; nextCursor: string | null };

// Wraps the MCP server with call counting and grading helpers
async function session(gatewayUrl: string, fetchFn?: FetchFn) {
    const user = await registerUser(gatewayUrl);
    const agent = await connectAgent(gatewayUrl, user, fetchFn ? { fetch: fetchFn } : {});
    let toolCalls = 0;
    let toolErrors = 0;
    const call = async (name: string, args: Record<string, unknown> = {}) => {
        toolCalls += 1;
        const result = await agent.call(name, args);
        if (result.isError) toolErrors += 1;
        return result;
    };
    const finish = async (check: (notes: RestNote[]) => string | null): Promise<ScenarioResult> => {
        const problem = check(await allNotes(gatewayUrl, user.accessToken));
        await agent.close();
        return { pass: problem === null, detail: problem ?? "ok", toolCalls, toolErrors };
    };
    return { user, call, finish };
}

export const scenarios: Scenario[] = [
    {
        name: "create, pin, search, update, delete",
        async run(gatewayUrl) {
            const s = await session(gatewayUrl);
            const a = note(await s.call("create_note", { title: "Invoice 1042", content: "Due Friday" }));
            const b = note(await s.call("create_note", { title: "Shopping", content: "milk" }));
            const c = note(await s.call("create_note", { title: "Scratch" }));
            await s.call("update_note", { id: a.id, isPinned: true });
            const found = page(await s.call("list_notes", { query: "invoice" })).notes;
            await s.call("update_note", { id: b.id, content: "milk, eggs" });
            await s.call("delete_note", { id: c.id });

            return s.finish((notes) => {
                if (found.length !== 1 || found[0]?.id !== a.id) return "search did not return exactly the invoice";
                const byTitle = Object.fromEntries(notes.map((n) => [n.title, n]));
                if (notes.length !== 2) return `expected 2 notes, found ${notes.length}`;
                if (!byTitle["Invoice 1042"]?.isPinned) return "invoice is not pinned";
                if (byTitle["Shopping"]?.content !== "milk, eggs") return "shopping content not updated";
                if (byTitle["Scratch"]) return "scratch note still exists";
                return null;
            });
        },
    },
    {
        name: "paginate 45 notes with limit 20",
        async run(gatewayUrl) {
            const s = await session(gatewayUrl);
            for (let i = 0; i < 45; i++) await s.call("create_note", { title: `Note ${String(i).padStart(2, "0")}` });

            const seen: string[] = [];
            let cursor: string | null = null;
            let pages = 0;
            do {
                const result = page(await s.call("list_notes", { limit: 20, ...(cursor ? { cursor } : {}) }));
                seen.push(...result.notes.map((n) => n.id));
                cursor = result.nextCursor;
                pages += 1;
            } while (cursor && pages < 10);

            return s.finish((notes) => {
                if (pages !== 3) return `expected 3 pages, got ${pages}`;
                if (seen.length !== 45) return `saw ${seen.length} notes across pages, expected 45`;
                if (new Set(seen).size !== 45) return "pages contained duplicates";
                const all = new Set(notes.map((n) => n.id));
                if (!seen.every((id) => all.has(id)) || all.size !== 45) return "pages and API disagree";
                return null;
            });
        },
    },
    {
        name: "not-found id gives an actionable error and changes nothing",
        async run(gatewayUrl) {
            const s = await session(gatewayUrl);
            await s.call("create_note", { title: "Keep me" });
            const missing = "6f1c2b8e-3d4a-4f5b-9c6d-7e8f9a0b1c2d";
            const results = [
                await s.call("get_note", { id: missing }),
                await s.call("update_note", { id: missing, title: "x" }),
                await s.call("delete_note", { id: missing }),
            ];

            return s.finish((notes) => {
                for (const r of results) {
                    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
                    if (!r.isError) return "a call on a missing id did not return isError";
                    if (!text.includes("call list_notes")) return `error is not actionable: ${text}`;
                }
                if (notes.length !== 1 || notes[0]?.title !== "Keep me") return "existing note was changed";
                return null;
            });
        },
    },
    {
        name: "recover when the access token expires mid-scenario",
        async run(gatewayUrl) {
            const tap = tokenTap();
            const s = await session(gatewayUrl, tap.fetch);
            tap.forUser(s.user);
            await s.call("create_note", { title: "Before expiry" });

            // The next notes request carries an expired (but correctly signed) access token, so the
            // real notes-service answers 401 and the MCP server has to refresh against auth-service
            tap.expireNext(1);
            const after = await s.call("create_note", { title: "After expiry" });

            return s.finish((notes) => {
                if (after.isError) return "create after expiry failed";
                if (tap.rejected !== 1) return `expected 1 rejected request, saw ${tap.rejected}`;
                if (tap.refreshes !== 1) return `expected 1 refresh, saw ${tap.refreshes}`;
                if (tap.logins !== 1) return `expected 1 login, saw ${tap.logins}`;
                const titles = notes.map((n) => n.title).sort();
                if (titles.join() !== "After expiry,Before expiry") return `unexpected notes: ${titles.join()}`;
                return null;
            });
        },
    },
    {
        name: "concurrent calls with an expired token share one refresh",
        async run(gatewayUrl) {
            const tap = tokenTap();
            const s = await session(gatewayUrl, tap.fetch);
            tap.forUser(s.user);
            await s.call("list_notes");

            tap.expireNext(5);
            const results = await Promise.all(
                Array.from({ length: 5 }, (_, i) => s.call("create_note", { title: `Parallel ${i}` })),
            );
            // A reused refresh token would have revoked every session; this call proves it didn't happen
            tap.expireNext(1);
            const later = await s.call("list_notes");

            return s.finish((notes) => {
                if (results.some((r) => r.isError) || later.isError) return "a call failed";
                if (tap.refreshes !== 2) return `expected 2 refreshes (one per expiry), saw ${tap.refreshes}`;
                if (tap.logins !== 1) return `expected 1 login, saw ${tap.logins}`;
                if (notes.length !== 5) return `expected 5 notes, found ${notes.length}`;
                return null;
            });
        },
    },
];

// A fetch wrapper that counts auth calls and can swap the next N notes requests' access token
// for an expired one signed with the stack's secret
function tokenTap() {
    let expiredToken = "";
    let pending = 0;
    const tap = {
        logins: 0,
        refreshes: 0,
        rejected: 0,
        forUser(user: TestUser) {
            const { sub, email } = jwt.decode(user.accessToken) as { sub: string; email: string };
            const past = Math.floor(Date.now() / 1000) - 3600;
            expiredToken = jwt.sign({ email, iat: past, exp: past + 60 }, STACK_JWT_SECRET, {
                algorithm: "HS256",
                subject: sub,
                issuer: STACK_JWT_ISSUER,
            });
        },
        expireNext(n: number) {
            pending = n;
        },
        fetch: (async (input, init) => {
            const path = new URL((input as URL).href).pathname;
            if (path.endsWith("/auth/login")) tap.logins += 1;
            if (path.endsWith("/auth/refresh")) tap.refreshes += 1;
            if (path.startsWith("/api/v1/notes") && pending > 0) {
                pending -= 1;
                const headers = new Headers(init?.headers);
                headers.set("Authorization", `Bearer ${expiredToken}`);
                const res = await fetch(input, { ...init, headers });
                if (res.status === 401) tap.rejected += 1;
                return res;
            }
            return fetch(input, init);
        }) as FetchFn,
    };
    return tap;
}
