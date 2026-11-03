#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConfigError, loadConfig } from "./config";
import { createNotepadServer } from "./server";

// stdout carries the MCP protocol, so everything human-readable goes to stderr
async function main() {
    let config;
    try {
        config = loadConfig();
    } catch (err) {
        console.error(err instanceof ConfigError ? err.message : "Could not read configuration");
        process.exit(1);
    }

    const { server, auth } = createNotepadServer(config);
    const shutdown = async () => {
        await auth.logout();
        await server.close();
        process.exit(0);
    };
    process.on("SIGINT", () => void shutdown());
    process.on("SIGTERM", () => void shutdown());
    process.stdin.on("end", () => void shutdown());

    await server.connect(new StdioServerTransport());
    console.error(`notepad MCP server running on stdio (API: ${config.apiUrl})`);
}

main().catch((err: unknown) => {
    console.error(`notepad MCP server failed to start: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
});
