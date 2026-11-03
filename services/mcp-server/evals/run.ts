import { startStack } from "../test/stack";
import { scenarios } from "./scenarios";

// Runs the deterministic evals against a freshly started stack and prints a summary table.
// Needs PostgreSQL at TEST_POSTGRES_URL. No LLM and no API key involved.
async function main() {
    const stack = await startStack();
    const rows: { scenario: string; result: string; toolCalls: number; toolErrors: number; detail: string }[] = [];
    try {
        for (const { name, run } of scenarios) {
            try {
                const r = await run(stack.gatewayUrl);
                rows.push({ scenario: name, result: r.pass ? "PASS" : "FAIL", ...r });
            } catch (err) {
                const detail = err instanceof Error ? err.message : String(err);
                rows.push({ scenario: name, result: "ERROR", toolCalls: 0, toolErrors: 0, detail });
            }
        }
    } finally {
        await stack.stop();
    }

    console.table(
        rows.map(({ scenario, result, toolCalls, toolErrors, detail }) => ({
            scenario,
            result,
            toolCalls,
            toolErrors,
            detail,
        })),
    );
    const passed = rows.filter((r) => r.result === "PASS").length;
    console.log(`${passed}/${rows.length} deterministic scenarios passed`);
    process.exitCode = passed === rows.length ? 0 : 1;
}

main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
});
