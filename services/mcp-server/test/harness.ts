import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createNotepadServer, ServerDeps } from "../src/server";

// Placeholder password that satisfies registration's rules; only used against the throwaway stack
export const TEST_PASSWORD = "Placeholder-Pass-1";

export interface TestUser {
    email: string;
    password: string;
    accessToken: string;
}

// Registers a fresh account through the gateway, so each test or scenario has its own data
export async function registerUser(gatewayUrl: string): Promise<TestUser> {
    const email = `mcp-${randomUUID()}@example.com`;
    const res = await fetch(`${gatewayUrl}/api/v1/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: TEST_PASSWORD }),
    });
    if (res.status !== 201) throw new Error(`register returned ${res.status}`);
    const { data } = (await res.json()) as { data: { accessToken: string } };
    return { email, password: TEST_PASSWORD, accessToken: data.accessToken };
}

export interface Agent {
    client: Client;
    call: (name: string, args?: Record<string, unknown>) => Promise<CallToolResult>;
    close: () => Promise<void>;
}

// An MCP client connected in-process to a notepad MCP server acting as `user`
export async function connectAgent(gatewayUrl: string, user: TestUser, deps: ServerDeps = {}): Promise<Agent> {
    const { server, auth } = createNotepadServer(
        { apiUrl: gatewayUrl, email: user.email, password: user.password },
        deps,
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "notepad-tests", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    return {
        client,
        call: async (name, args = {}) => (await client.callTool({ name, arguments: args })) as CallToolResult,
        close: async () => {
            await auth.logout();
            await client.close();
            await server.close();
        },
    };
}

export interface RestNote {
    id: string;
    title: string;
    content: string;
    isPinned: boolean;
}

// Reads every note of a user straight from the REST API (not through MCP), for grading final state
export async function allNotes(gatewayUrl: string, accessToken: string): Promise<RestNote[]> {
    const notes: RestNote[] = [];
    let cursor: string | null = null;
    do {
        const url = new URL(`${gatewayUrl}/api/v1/notes`);
        url.searchParams.set("limit", "100");
        if (cursor) url.searchParams.set("cursor", cursor);
        const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!res.ok) throw new Error(`GET /notes returned ${res.status}`);
        const { data } = (await res.json()) as { data: { notes: RestNote[]; nextCursor: string | null } };
        notes.push(...data.notes);
        cursor = data.nextCursor;
    } while (cursor);
    return notes;
}

export function textOf(result: CallToolResult): string {
    return result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
}
