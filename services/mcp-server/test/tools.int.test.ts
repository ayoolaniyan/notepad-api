import { afterEach, describe, expect, it } from "@jest/globals";
import { Agent, allNotes, connectAgent, registerUser, textOf } from "./harness";

// Calls the MCP tools end to end: MCP client -> MCP server -> real gateway -> real services -> Postgres.
// Every test registers its own user, so tests never see each other's notes.

const gatewayUrl = process.env["MCP_TEST_GATEWAY_URL"]!;
const agents: Agent[] = [];

afterEach(async () => {
    await Promise.all(agents.splice(0).map((a) => a.close()));
});

async function newAgent() {
    const user = await registerUser(gatewayUrl);
    const agent = await connectAgent(gatewayUrl, user);
    agents.push(agent);
    return { user, agent };
}

interface ToolNote {
    id: string;
    title: string;
    content: string;
    isPinned: boolean;
    contentTruncated?: boolean;
}

const noteOf = (result: { structuredContent?: unknown }) => (result.structuredContent as { note: ToolNote }).note;
const pageOf = (result: { structuredContent?: unknown }) =>
    result.structuredContent as { notes: ToolNote[]; nextCursor: string | null };

describe("notepad MCP tools against the real stack", () => {
    it("creates a note and reads it back", async () => {
        const { agent } = await newAgent();

        const created = await agent.call("create_note", { title: "Shopping", content: "Milk, eggs" });
        expect(created.isError).toBeFalsy();
        const note = noteOf(created);

        const got = await agent.call("get_note", { id: note.id });

        expect(noteOf(got)).toMatchObject({ id: note.id, title: "Shopping", content: "Milk, eggs", isPinned: false });
    });

    it("lists with search and the pinned filter", async () => {
        const { agent } = await newAgent();
        await agent.call("create_note", { title: "Invoice March", isPinned: true });
        await agent.call("create_note", { title: "Holiday plan", content: "pay the INVOICE first" });
        await agent.call("create_note", { title: "Recipes" });

        const search = pageOf(await agent.call("list_notes", { query: "invoice" }));
        const pinned = pageOf(await agent.call("list_notes", { pinned: true }));

        expect(search.notes.map((n) => n.title).sort()).toEqual(["Holiday plan", "Invoice March"]);
        expect(pinned.notes.map((n) => n.title)).toEqual(["Invoice March"]);
    });

    it("paginates with the cursor without gaps or duplicates", async () => {
        const { agent } = await newAgent();
        for (let i = 0; i < 7; i++) await agent.call("create_note", { title: `Note ${i}` });

        const seen: string[] = [];
        let cursor: string | null | undefined;
        let pages = 0;
        do {
            const page = pageOf(await agent.call("list_notes", { limit: 3, ...(cursor ? { cursor } : {}) }));
            seen.push(...page.notes.map((n) => n.title));
            cursor = page.nextCursor;
            pages += 1;
        } while (cursor);

        expect(pages).toBe(3);
        expect(new Set(seen).size).toBe(7);
        expect(seen).toHaveLength(7);
    });

    it("truncates long content in lists but returns it in full from get_note", async () => {
        const { agent } = await newAgent();
        const content = "word ".repeat(200); // 1,000 characters
        const note = noteOf(await agent.call("create_note", { title: "Long", content }));

        const [listed] = pageOf(await agent.call("list_notes")).notes;
        const full = noteOf(await agent.call("get_note", { id: note.id }));

        expect(listed?.contentTruncated).toBe(true);
        expect(listed?.content).toHaveLength(300);
        expect(full.content).toBe(content);
    });

    it("updates and deletes, and the API agrees", async () => {
        const { user, agent } = await newAgent();
        const keep = noteOf(await agent.call("create_note", { title: "Keep" }));
        const drop = noteOf(await agent.call("create_note", { title: "Drop" }));

        const updated = await agent.call("update_note", { id: keep.id, title: "Kept", isPinned: true });
        const deleted = await agent.call("delete_note", { id: drop.id });

        expect(noteOf(updated)).toMatchObject({ title: "Kept", isPinned: true });
        expect(deleted.structuredContent).toEqual({ deleted: true, id: drop.id });
        const final = await allNotes(gatewayUrl, user.accessToken);
        expect(final.map((n) => ({ title: n.title, isPinned: n.isPinned }))).toEqual([
            { title: "Kept", isPinned: true },
        ]);
    });

    it("returns an actionable not-found error for missing ids", async () => {
        const { agent } = await newAgent();
        const missing = "6f1c2b8e-3d4a-4f5b-9c6d-7e8f9a0b1c2d";

        for (const result of [
            await agent.call("get_note", { id: missing }),
            await agent.call("update_note", { id: missing, title: "x" }),
            await agent.call("delete_note", { id: missing }),
        ]) {
            expect(result.isError).toBe(true);
            expect(textOf(result)).toMatch(/^Note not found\..*call list_notes/);
        }
    });

    it("maps the API's own validation errors", async () => {
        const { agent } = await newAgent();

        const result = await agent.call("list_notes", { cursor: "not-a-real-cursor" });

        expect(result.isError).toBe(true);
        expect(textOf(result)).toMatch(/^Invalid cursor\./);
    });

    it("keeps each user's notes invisible to another user's server instance", async () => {
        const alice = await newAgent();
        const bob = await newAgent();
        const secret = noteOf(await alice.agent.call("create_note", { title: "Alice only" }));

        const bobList = pageOf(await bob.agent.call("list_notes"));
        const bobGet = await bob.agent.call("get_note", { id: secret.id });
        const bobUpdate = await bob.agent.call("update_note", { id: secret.id, title: "hijacked" });
        const bobDelete = await bob.agent.call("delete_note", { id: secret.id });

        expect(bobList.notes).toEqual([]);
        for (const result of [bobGet, bobUpdate, bobDelete]) expect(result.isError).toBe(true);
        const aliceNotes = await allNotes(gatewayUrl, alice.user.accessToken);
        expect(aliceNotes.map((n) => n.title)).toEqual(["Alice only"]);
    });
});
