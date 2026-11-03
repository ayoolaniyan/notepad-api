import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AuthManager, AuthManagerOptions } from "./auth";
import type { Config } from "./config";
import { ApiClient, FetchFn } from "./http";
import { registerNoteTools } from "./tools";

export const SERVER_NAME = "notepad";
export const SERVER_VERSION = "1.0.0";

export interface ServerDeps extends AuthManagerOptions {
    fetch?: FetchFn;
}

// Builds the MCP server without connecting a transport, so tests and evals can attach their own
export function createNotepadServer(config: Config, { fetch: fetchFn, ...authOptions }: ServerDeps = {}) {
    const api = new ApiClient(config.apiUrl, fetchFn);
    const auth = new AuthManager(api, { email: config.email, password: config.password }, authOptions);
    const server = new McpServer(
        { name: SERVER_NAME, version: SERVER_VERSION },
        {
            instructions:
                "Tools for the user's notes in notepad-api. Use list_notes to find notes and their ids (content is " +
                "previewed), get_note for full text, and create_note / update_note / delete_note to change them. " +
                "delete_note is permanent.",
        },
    );
    registerNoteTools(server, api, auth);
    return { server, auth };
}
