import { startStack, Stack } from "./stack";

declare global {
    var mcpStack: Stack | undefined;
}

// Starts the stack once for all integration test files. Workers inherit the gateway URL through
// the environment; global-teardown stops the processes.
export default async function globalSetup(): Promise<void> {
    globalThis.mcpStack = await startStack();
    process.env["MCP_TEST_GATEWAY_URL"] = globalThis.mcpStack.gatewayUrl;
}
