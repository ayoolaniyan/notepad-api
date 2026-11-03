import { afterEach, describe, expect, it } from "@jest/globals";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createFakeGateway, FAKE_PASSWORD, json } from "../test/fake-gateway";
import { ApiError } from "./http";
import { createNotepadServer } from "./server";
import { describeError, PREVIEW_LENGTH, preview } from "./tools";

const UNKNOWN_ID = "6f1c2b8e-3d4a-4f5b-9c6d-7e8f9a0b1c2d";
const closers: (() => Promise<void>)[] = [];

afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()));
});

async function connect() {
    const gateway = createFakeGateway();
    const { server } = createNotepadServer(
        { apiUrl: "http://gateway.test", email: "user@example.com", password: FAKE_PASSWORD },
        { fetch: gateway.fetch },
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    closers.push(() => client.close());
    const call = async (name: string, args: Record<string, unknown> = {}) =>
        (await client.callTool({ name, arguments: args })) as CallToolResult;
    return { gateway, client, call };
}

const text = (result: CallToolResult) => result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");

describe("tool definitions", () => {
    it("exposes the five note tools with honest annotations", async () => {
        const { client } = await connect();

        const { tools } = await client.listTools();
        const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

        expect(Object.keys(byName).sort()).toEqual([
            "create_note",
            "delete_note",
            "get_note",
            "list_notes",
            "update_note",
        ]);
        expect(byName["list_notes"]?.annotations?.readOnlyHint).toBe(true);
        expect(byName["get_note"]?.annotations?.readOnlyHint).toBe(true);
        expect(byName["delete_note"]?.annotations).toMatchObject({ destructiveHint: true, idempotentHint: true });
        expect(byName["update_note"]?.annotations?.idempotentHint).toBe(false);
        expect(byName["create_note"]?.annotations?.idempotentHint).toBe(false);
        expect(byName["list_notes"]?.description).toContain("get_note");
        expect(byName["delete_note"]?.description).toMatch(/permanent/i);
        for (const tool of tools) expect(tool.outputSchema).toBeDefined();
    });
});

describe("note tools", () => {
    it("creates, reads, updates and deletes a note with structured results", async () => {
        const { call } = await connect();

        const created = await call("create_note", { title: "  Groceries ", content: "milk", isPinned: true });
        expect(created.isError).toBeFalsy();
        const { note } = created.structuredContent as { note: { id: string; title: string } };
        expect(note.title).toBe("Groceries");

        const got = await call("get_note", { id: note.id });
        expect(text(got)).toContain("milk");

        const updated = await call("update_note", { id: note.id, content: "milk, eggs" });
        expect((updated.structuredContent as { note: { content: string } }).note.content).toBe("milk, eggs");

        const deleted = await call("delete_note", { id: note.id });
        expect(deleted.structuredContent).toEqual({ deleted: true, id: note.id });

        const gone = await call("get_note", { id: note.id });
        expect(gone.isError).toBe(true);
        expect(text(gone)).toMatch(/Note not found.*call list_notes/);
    });

    it("truncates list content to a preview and flags it", async () => {
        const { call } = await connect();
        await call("create_note", { title: "Long", content: "x".repeat(PREVIEW_LENGTH + 50) });
        await call("create_note", { title: "Short", content: "tiny" });

        const result = await call("list_notes");
        const { notes, nextCursor } = result.structuredContent as {
            notes: { title: string; content: string; contentTruncated: boolean }[];
            nextCursor: string | null;
        };

        const long = notes.find((n) => n.title === "Long")!;
        const short = notes.find((n) => n.title === "Short")!;
        expect(long.content).toHaveLength(PREVIEW_LENGTH);
        expect(long.contentTruncated).toBe(true);
        expect(short).toMatchObject({ content: "tiny", contentTruncated: false });
        expect(nextCursor).toBeNull();
    });

    it("maps list_notes inputs to the API's query parameters", async () => {
        const { call, gateway } = await connect();

        await call("list_notes", { limit: 5, query: "milk", pinned: true, cursor: "abc" });

        const listRequest = gateway.state.requests.find((r) => r.path === "/api/v1/notes" && r.method === "GET");
        expect(listRequest?.search).toBe("?limit=5&cursor=abc&q=milk&pinned=true");
    });

    it("rejects update_note without any field to change, without calling the API", async () => {
        const { call, gateway } = await connect();

        const result = await call("update_note", { id: UNKNOWN_ID });

        expect(result.isError).toBe(true);
        expect(text(result)).toMatch(/at least one of title, content or isPinned/);
        expect(gateway.state.requests).toHaveLength(0);
    });

    it.each([
        ["create_note", { title: "" }, /title/],
        ["create_note", { title: "t".repeat(201) }, /title must be at most 200 characters/],
        ["create_note", { title: "ok", content: "c".repeat(100_001) }, /content must be at most 100000 characters/],
        ["get_note", { id: "not-a-uuid" }, /id must be a note id/],
        ["list_notes", { limit: 101 }, /limit/],
        ["list_notes", { query: "q".repeat(201) }, /query/],
    ])("validates %s input %#", async (tool, args, message) => {
        const { call, gateway } = await connect();

        const result = await call(tool, args);

        expect(result.isError).toBe(true);
        expect(text(result)).toMatch(message);
        expect(gateway.state.requests).toHaveLength(0);
    });

    it("turns a 400 from the API into a short field list", async () => {
        const { call, gateway } = await connect();
        gateway.state.override = (req) =>
            req.method === "POST" && req.path === "/api/v1/notes"
                ? json(400, {
                      success: false,
                      error: "Validation failed",
                      errors: { title: ["Title cannot be empty"], isPinned: ['"isPinned" must be a boolean'] },
                  })
                : undefined;

        const result = await call("create_note", { title: "x" });

        expect(result.isError).toBe(true);
        expect(text(result)).toBe(
            'Validation failed: title: Title cannot be empty | isPinned: "isPinned" must be a boolean.',
        );
    });

    it("reports rate limits with the retry delay", async () => {
        const { call, gateway } = await connect();
        gateway.state.override = (req) =>
            req.path === "/api/v1/notes"
                ? json(429, { success: false, error: "Too many requests" }, { "Retry-After": "12" })
                : undefined;

        const result = await call("list_notes");

        expect(result.isError).toBe(true);
        expect(text(result)).toBe("Rate limited by the gateway; retry after 12 seconds.");
    });

    it("never leaks tokens or the password into tool output", async () => {
        const { call, gateway } = await connect();
        gateway.state.override = (req) =>
            req.path === "/api/v1/notes" ? json(500, { success: false, error: "Internal server error" }) : undefined;

        const results = [await call("list_notes"), await call("create_note", { title: "x" })];

        for (const result of results) {
            const output = JSON.stringify(result);
            expect(output).not.toMatch(/access-\d|refresh-\d/);
            expect(output).not.toContain(FAKE_PASSWORD);
            expect(output).not.toMatch(/\bat .*\.ts:\d+/); // no stack frames
        }
    });
});

describe("describeError", () => {
    it.each([
        [new ApiError("http", 400, "Invalid cursor"), /Pass the nextCursor/],
        [new ApiError("http", 429, "Too many"), /wait a minute/],
        [new ApiError("http", 504, "Service timed out"), /temporarily unavailable \(504 Service timed out\)/],
        [new ApiError("http", 413, "Request body too large"), /under 100,000 characters/],
        [new ApiError("timeout", 0, "No response from notepad-api within 10 seconds"), /check with list_notes/],
        [new ApiError("network", 0, "Could not reach notepad-api at http://x"), /gateway is running/],
        [new Error("boom with internals"), /^Unexpected error in the notepad MCP server\.$/],
    ])("describes %p", (error, message) => {
        expect(describeError(error)).toMatch(message);
    });
});

describe("preview", () => {
    const note = { id: "1", title: "t", isPinned: false, createdAt: "", updatedAt: "" };

    it("does not split a surrogate pair at the cut", () => {
        const content = "a".repeat(PREVIEW_LENGTH - 1) + "😀" + "tail";

        const result = preview({ ...note, content });

        expect(result.contentTruncated).toBe(true);
        expect(result.content).toBe("a".repeat(PREVIEW_LENGTH - 1));
    });
});
