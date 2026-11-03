import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { AuthError, AuthManager } from "./auth";
import { ApiClient, ApiError, RequestOptions } from "./http";

// List results carry a preview, not the whole note: content can be up to 100,000 characters, so
// a full page of 100 notes could run to 10M characters. 300 characters (a short paragraph) is
// enough to recognise a note; a page then stays around 50k characters even with 200-character titles.
export const PREVIEW_LENGTH = 300;

// Limits mirror notes-service's validation (services/notes-service/src/validation.ts)
const TITLE_MAX = 200;
const CONTENT_MAX = 100_000;

const noteShape = {
    id: z.string(),
    title: z.string(),
    content: z.string(),
    isPinned: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
};
type Note = z.infer<z.ZodObject<typeof noteShape>>;

const noteId = z.uuid({ error: "id must be a note id (a UUID) as returned by list_notes or create_note" });
const title = z
    .string()
    .trim()
    .min(1, { error: "title must not be empty" })
    .max(TITLE_MAX, { error: `title must be at most ${TITLE_MAX} characters` });
const content = z.string().max(CONTENT_MAX, { error: `content must be at most ${CONTENT_MAX} characters` });

const NOT_FOUND = "Note not found. The id may be wrong or the note was deleted; call list_notes to find valid ids.";

export function registerNoteTools(server: McpServer, api: ApiClient, auth: AuthManager): void {
    const call = <T>(method: string, path: string, options: Omit<RequestOptions, "token"> = {}) =>
        auth.call((token) => api.request<T>(method, path, { ...options, token }));

    server.registerTool(
        "list_notes",
        {
            title: "List notes",
            description:
                "List the user's notes, pinned first, then most recently updated. Use this to find notes and their ids. " +
                `Each note's content is cut to a ${PREVIEW_LENGTH}-character preview and contentTruncated says whether ` +
                "it was; call get_note for the full text. Returns at most `limit` notes (1-100, default 20). When " +
                "nextCursor is not null there are more notes: call again with the same filters and that cursor. " +
                "`query` is a case-insensitive substring match on title or content (1-200 characters); `pinned` " +
                "filters by pinned state.",
            inputSchema: {
                limit: z.number().int().min(1).max(100).optional().describe("Page size, 1-100 (default 20)"),
                cursor: z.string().max(500).optional().describe("nextCursor from the previous page, unchanged"),
                query: z.string().trim().min(1).max(200).optional().describe("Text to search for in title or content"),
                pinned: z.boolean().optional().describe("true: only pinned notes; false: only unpinned notes"),
            },
            outputSchema: {
                notes: z.array(z.object({ ...noteShape, contentTruncated: z.boolean() })),
                nextCursor: z.string().nullable(),
            },
            annotations: { readOnlyHint: true, openWorldHint: false },
        },
        async ({ limit, cursor, query, pinned }) =>
            run(async () => {
                const page = await call<{ notes: Note[]; nextCursor: string | null }>("GET", "/notes", {
                    query: { limit, cursor, q: query, pinned },
                });
                const notes = page.notes.map(preview);
                const lines = notes.map(
                    (n) =>
                        `- ${n.isPinned ? "[pinned] " : ""}${n.title} (id ${n.id}): ${n.content}${n.contentTruncated ? "…" : ""}`,
                );
                const text = [
                    `${notes.length} note(s).`,
                    ...lines,
                    page.nextCursor ? `More notes available: nextCursor=${page.nextCursor}` : "No more notes.",
                ].join("\n");
                return { text, structured: { notes, nextCursor: page.nextCursor } };
            }),
    );

    server.registerTool(
        "get_note",
        {
            title: "Get note",
            description: "Get one note by id, with its full content (up to 100,000 characters).",
            inputSchema: { id: noteId },
            outputSchema: { note: z.object(noteShape) },
            annotations: { readOnlyHint: true, openWorldHint: false },
        },
        async ({ id }) =>
            run(async () => {
                const { note } = await call<{ note: Note }>("GET", `/notes/${id}`);
                return { text: render(note), structured: { note } };
            }),
    );

    server.registerTool(
        "create_note",
        {
            title: "Create note",
            description:
                "Create a note and return it with its new id. title is required (1-200 characters, trimmed); content " +
                "is optional plain text (up to 100,000 characters, default empty); isPinned defaults to false. Not " +
                "idempotent: calling it twice creates two notes.",
            inputSchema: {
                title,
                content: content.optional(),
                isPinned: z.boolean().optional(),
            },
            outputSchema: { note: z.object(noteShape) },
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        },
        async (body) =>
            run(async () => {
                const { note } = await call<{ note: Note }>("POST", "/notes", { body });
                return { text: `Created note ${note.id}.\n${render(note)}`, structured: { note } };
            }),
    );

    server.registerTool(
        "update_note",
        {
            title: "Update note",
            description:
                "Change a note's title, content and/or pinned state. Pass the id and at least one of title (1-200 " +
                "characters), content (replaces the whole content, up to 100,000 characters) or isPinned; omitted " +
                "fields are left unchanged. Returns the updated note. Every update also moves the note to the top of " +
                "its group in list_notes, because the list is ordered by last update.",
            inputSchema: {
                id: noteId,
                title: title.optional(),
                content: content.optional(),
                isPinned: z.boolean().optional(),
            },
            outputSchema: { note: z.object(noteShape) },
            // Not idempotent: every call bumps updatedAt, which changes list order
            annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        },
        async ({ id, ...changes }) => {
            if (Object.values(changes).every((v) => v === undefined)) {
                return toolError("Nothing to update: pass at least one of title, content or isPinned.");
            }
            return run(async () => {
                const { note } = await call<{ note: Note }>("PATCH", `/notes/${id}`, { body: changes });
                return { text: `Updated note ${note.id}.\n${render(note)}`, structured: { note } };
            });
        },
    );

    server.registerTool(
        "delete_note",
        {
            title: "Delete note",
            description:
                "Permanently delete a note by id. This cannot be undone: there is no trash or restore. Deleting an id " +
                "that no longer exists returns a not-found error and changes nothing.",
            inputSchema: { id: noteId },
            outputSchema: { deleted: z.literal(true), id: z.string() },
            annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        },
        async ({ id }) =>
            run(async () => {
                await call("DELETE", `/notes/${id}`);
                return { text: `Deleted note ${id}.`, structured: { deleted: true as const, id } };
            }),
    );
}

export function preview(note: Note): Note & { contentTruncated: boolean } {
    if (note.content.length <= PREVIEW_LENGTH) return { ...note, contentTruncated: false };
    let end = PREVIEW_LENGTH;
    // Don't split a surrogate pair (emoji and other astral characters)
    const last = note.content.charCodeAt(end - 1);
    if (last >= 0xd800 && last <= 0xdbff) end -= 1;
    return { ...note, content: note.content.slice(0, end), contentTruncated: true };
}

function render(note: Note): string {
    return [
        `Title: ${note.title}`,
        `Id: ${note.id}`,
        `Pinned: ${note.isPinned ? "yes" : "no"}`,
        `Updated: ${note.updatedAt}`,
        "",
        note.content || "(no content)",
    ].join("\n");
}

async function run(fn: () => Promise<{ text: string; structured: Record<string, unknown> }>): Promise<CallToolResult> {
    try {
        const { text, structured } = await fn();
        return { content: [{ type: "text", text }], structuredContent: structured };
    } catch (err) {
        return toolError(describeError(err));
    }
}

function toolError(text: string): CallToolResult {
    return { content: [{ type: "text", text }], isError: true };
}

// Turns any failure into a short message that tells the model what to do next.
// Stack traces and tokens never reach the client.
export function describeError(err: unknown): string {
    if (err instanceof AuthError) return err.message;
    if (!(err instanceof ApiError)) return "Unexpected error in the notepad MCP server.";

    if (err.kind === "timeout") {
        return `${err.message}. A create or update may still have been applied: check with list_notes or get_note before retrying.`;
    }
    if (err.kind === "network") return `${err.message}. Check that the notepad-api gateway is running.`;

    switch (err.status) {
        case 400: {
            if (err.message === "Invalid cursor") {
                return "Invalid cursor. Pass the nextCursor from the previous list_notes result unchanged, or omit it to start again.";
            }
            const fields = Object.entries(err.fieldErrors ?? {}).map(([field, msgs]) => `${field}: ${msgs.join("; ")}`);
            return fields.length ? `Validation failed: ${fields.join(" | ")}.` : `Bad request: ${err.message}.`;
        }
        case 401:
            return "Not authenticated with notepad-api, even after signing in again. Retry once; if it persists, check the server's credentials.";
        case 404:
            return NOT_FOUND;
        case 413:
            return "Request too large: keep content under 100,000 characters.";
        case 429:
            return err.retryAfterSeconds !== undefined
                ? `Rate limited by the gateway; retry after ${err.retryAfterSeconds} seconds.`
                : "Rate limited by the gateway; wait a minute before retrying.";
        case 502:
        case 503:
        case 504:
            return `notepad-api is temporarily unavailable (${err.status} ${err.message}). Retry in a few seconds.`;
        default:
            return `notepad-api returned ${err.status}: ${err.message}.`;
    }
}
