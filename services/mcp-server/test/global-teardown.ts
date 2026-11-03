import "./global-setup";

export default async function globalTeardown(): Promise<void> {
    await globalThis.mcpStack?.stop();
}
