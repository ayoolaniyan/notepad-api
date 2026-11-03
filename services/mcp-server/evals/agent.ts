import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { allNotes, connectAgent, registerUser, RestNote, TestUser } from "../test/harness";
import { startStack } from "../test/stack";

// Optional agent evals: a Claude model gets a natural-language task and the notepad MCP tools,
// and is graded on the final state of the user's notes (read from the REST API), not on its reply.
//
// Off unless ANTHROPIC_API_KEY is set. Each run calls the Claude API and costs money.
//   ANTHROPIC_API_KEY=... TEST_POSTGRES_URL=... npm run evals:agent -w mcp-server
// EVAL_MODEL picks the model (default claude-opus-5-5). Results go to evals/results/ (git-ignored).

const MODEL = process.env["EVAL_MODEL"] ?? "claude-opus-5-5";
const MAX_TURNS = 20;
// Models that accept server-side refusal fallbacks (fallbacks: "default")
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);

interface Seed {
    title: string;
    content?: string;
    isPinned?: boolean;
}

interface Task {
    name: string;
    prompt: string;
    seed: Seed[];
    // Returns null when the final state is right, otherwise what is wrong
    grade: (notes: RestNote[]) => string | null;
}

const byTitle = (notes: RestNote[], title: string) => notes.filter((n) => n.title === title);

const tasks: Task[] = [
    {
        name: "pin invoices, delete scratch",
        prompt: "Pin all my notes that mention 'invoice' and delete the ones titled 'scratch'.",
        seed: [
            { title: "Invoice 1042", content: "Acme, due Friday" },
            { title: "Taxes", content: "Ask the accountant for the March invoice" },
            { title: "scratch", content: "asdf" },
            { title: "scratch", content: "temp" },
            { title: "Groceries", content: "milk, eggs" },
            { title: "Holiday", content: "book flights", isPinned: true },
        ],
        grade(notes) {
            if (byTitle(notes, "scratch").length) return "scratch notes still exist";
            for (const t of ["Invoice 1042", "Taxes"]) if (!byTitle(notes, t)[0]?.isPinned) return `${t} not pinned`;
            if (byTitle(notes, "Groceries")[0]?.isPinned !== false) return "Groceries was changed or deleted";
            if (byTitle(notes, "Holiday")[0]?.isPinned !== true) return "Holiday was changed or deleted";
            return notes.length === 4 ? null : `expected 4 notes, found ${notes.length}`;
        },
    },
    {
        name: "rename and append",
        prompt: "Rename my note 'Meeting notes' to 'Q3 planning meeting' and add the line 'Action: send summary' to the end of its content.",
        seed: [
            { title: "Meeting notes", content: "Discussed budget.\nAgreed on hiring plan." },
            { title: "Other meeting", content: "Unrelated" },
        ],
        grade(notes) {
            const [note] = byTitle(notes, "Q3 planning meeting");
            if (!note) return "renamed note not found";
            if (!note.content.startsWith("Discussed budget.\nAgreed on hiring plan.")) return "original content lost";
            if (!note.content.trimEnd().endsWith("Action: send summary")) return "line not appended";
            if (byTitle(notes, "Other meeting")[0]?.content !== "Unrelated") return "other note changed";
            return notes.length === 2 ? null : `expected 2 notes, found ${notes.length}`;
        },
    },
    {
        name: "count across pages",
        prompt: "How many notes do I have? Create a new note titled 'Count' whose content is just that number (counting the notes that existed before you created it).",
        seed: Array.from({ length: 45 }, (_, i) => ({ title: `Log ${i + 1}` })),
        grade(notes) {
            const [count] = byTitle(notes, "Count");
            if (!count) return "Count note not created";
            return count.content.trim() === "45" ? null : `Count content was "${count.content}", expected 45`;
        },
    },
    {
        name: "missing note is left alone",
        prompt: "Delete my note titled 'Old draft'.",
        seed: [{ title: "New draft" }, { title: "Draft ideas" }],
        grade(notes) {
            const titles = notes.map((n) => n.title).sort();
            return titles.join() === "Draft ideas,New draft" ? null : `notes changed: ${titles.join()}`;
        },
    },
];

async function seed(gatewayUrl: string, user: TestUser, notes: Seed[]) {
    for (const note of notes) {
        const res = await fetch(`${gatewayUrl}/api/v1/notes`, {
            method: "POST",
            headers: { Authorization: `Bearer ${user.accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify(note),
        });
        if (res.status !== 201) throw new Error(`seeding returned ${res.status}`);
    }
}

async function runTask(client: Anthropic, gatewayUrl: string, task: Task) {
    const user = await registerUser(gatewayUrl);
    await seed(gatewayUrl, user, task.seed);
    const agent = await connectAgent(gatewayUrl, user);
    const { tools: mcpTools } = await agent.client.listTools();
    const tools: Anthropic.Beta.BetaTool[] = mcpTools.map((t) => ({
        name: t.name,
        description: t.description ?? "",
        input_schema: t.inputSchema,
    }));

    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: task.prompt }];
    let toolCalls = 0;
    let toolErrors = 0;
    let turns = 0;
    let stopReason: string | null = null;
    try {
        while (turns < MAX_TURNS) {
            turns += 1;
            const response = await client.beta.messages.create({
                model: MODEL,
                max_tokens: 16000,
                system: "You manage the user's notes with the provided tools. Complete the task, then reply briefly.",
                tools,
                messages,
                ...(FALLBACK_MODELS.has(MODEL)
                    ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
                    : {}),
            });
            stopReason = response.stop_reason;
            // Pass the whole content back unchanged (thinking blocks included)
            messages.push({ role: "assistant", content: response.content });
            if (response.stop_reason === "pause_turn") continue;
            if (response.stop_reason !== "tool_use") break;

            const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
            for (const block of response.content) {
                if (block.type !== "tool_use") continue;
                toolCalls += 1;
                const result = await agent.call(block.name, block.input as Record<string, unknown>);
                if (result.isError) toolErrors += 1;
                const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
                results.push({ type: "tool_result", tool_use_id: block.id, content: text, is_error: !!result.isError });
            }
            // All results for one assistant turn go back in a single user message
            messages.push({ role: "user", content: results });
        }
    } finally {
        await agent.close();
    }

    const problem =
        stopReason === "refusal"
            ? "model refused"
            : turns >= MAX_TURNS && stopReason === "tool_use"
              ? `no answer within ${MAX_TURNS} turns`
              : task.grade(await allNotes(gatewayUrl, user.accessToken));
    return {
        task: task.name,
        pass: problem === null,
        detail: problem ?? "ok",
        toolCalls,
        toolErrors,
        turns,
        stopReason,
    };
}

async function main() {
    if (!process.env["ANTHROPIC_API_KEY"]) {
        console.log("Agent evals skipped: set ANTHROPIC_API_KEY to run them (each run calls the Claude API).");
        return;
    }
    const client = new Anthropic();
    const stack = await startStack();
    const results = [];
    try {
        for (const task of tasks) {
            try {
                results.push(await runTask(client, stack.gatewayUrl, task));
            } catch (err) {
                const detail = err instanceof Error ? err.message : String(err);
                results.push({
                    task: task.name,
                    pass: false,
                    detail,
                    toolCalls: 0,
                    toolErrors: 0,
                    turns: 0,
                    stopReason: null,
                });
            }
        }
    } finally {
        await stack.stop();
    }

    console.table(results);
    const passed = results.filter((r) => r.pass).length;
    console.log(`${passed}/${results.length} agent tasks passed (model ${MODEL})`);

    const dir = path.join(__dirname, "results");
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `agent-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    writeFileSync(file, JSON.stringify({ model: MODEL, ranAt: new Date().toISOString(), results }, null, 2));
    console.log(`Results written to ${path.relative(process.cwd(), file)}`);
}

main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
});
