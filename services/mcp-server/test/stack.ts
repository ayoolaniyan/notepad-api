import { ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { Client } from "pg";

// Starts the real stack (auth-service, notes-service and the gateway) as child processes against
// throwaway databases, for the integration tests and the deterministic evals.
//
// Child processes rather than one process: auth-service and notes-service both read DATABASE_URL
// when their config module loads, so they can't share one Node process with different databases.

const REPO = path.resolve(__dirname, "../../..");

// Own databases, so these runs never touch the ones the services' own integration tests reset.
// Names must end in _test: they're wiped on every start.
const DATABASES = { auth: "notepad_mcp_auth_test", notes: "notepad_mcp_notes_test" } as const;

// A test-only signing secret; the stack exists only for the duration of a run
export const STACK_JWT_SECRET = "mcp-stack-test-secret-that-is-at-least-32-chars";
export const STACK_JWT_ISSUER = "notepad-auth-service";

export interface Stack {
    gatewayUrl: string;
    stop: () => Promise<void>;
}

export const testServerUrl = (
    process.env["TEST_POSTGRES_URL"] ?? "postgresql://postgres:postgres@localhost:5432"
).replace(/\/$/, "");

export async function startStack(): Promise<Stack> {
    ensureBuilt();
    await Promise.all([
        prepareDatabase("auth-service", DATABASES.auth),
        prepareDatabase("notes-service", DATABASES.notes),
    ]);

    const [authPort, notesPort, gatewayPort] = await Promise.all([freePort(), freePort(), freePort()]);
    const common = { NODE_ENV: "test", DOTENV_CONFIG_QUIET: "true", HOST: "127.0.0.1" };
    const jwt = { JWT_ACCESS_SECRET: STACK_JWT_SECRET, JWT_ISSUER: STACK_JWT_ISSUER };

    const children = [
        startService("auth-service", {
            ...common,
            ...jwt,
            PORT: String(authPort),
            DATABASE_URL: `${testServerUrl}/${DATABASES.auth}`,
            ACCESS_TOKEN_TTL_SECONDS: "900",
            REFRESH_TOKEN_TTL_DAYS: "7",
            REFRESH_TOKEN_CLEANUP_INTERVAL_MINUTES: "60",
            LOGIN_MAX_FAILURES: "10",
            LOGIN_LOCKOUT_WINDOW_MINUTES: "15",
        }),
        startService("notes-service", {
            ...common,
            ...jwt,
            PORT: String(notesPort),
            DATABASE_URL: `${testServerUrl}/${DATABASES.notes}`,
        }),
        startService("api-gateway", {
            ...common,
            PORT: String(gatewayPort),
            AUTH_SERVICE_URL: `http://127.0.0.1:${authPort}`,
            NOTES_SERVICE_URL: `http://127.0.0.1:${notesPort}`,
            UPSTREAM_TIMEOUT_MS: "10000",
            CORS_ORIGINS: "http://localhost:5173",
            TRUST_PROXY: "0",
            MAX_BODY_BYTES: String(1024 * 1024),
            // Every test registers and logs in fresh users from one IP
            RATE_LIMIT_GLOBAL_MAX: "100000",
            RATE_LIMIT_GLOBAL_WINDOW_MS: "60000",
            RATE_LIMIT_LOGIN_MAX: "100000",
            RATE_LIMIT_LOGIN_WINDOW_MS: "60000",
            RATE_LIMIT_REGISTER_MAX: "100000",
            RATE_LIMIT_REGISTER_WINDOW_MS: "60000",
            RATE_LIMIT_REFRESH_MAX: "100000",
            RATE_LIMIT_REFRESH_WINDOW_MS: "60000",
        }),
    ];

    const stop = async () => {
        await Promise.all(children.map((c) => stopChild(c.process)));
    };

    const gatewayUrl = `http://127.0.0.1:${gatewayPort}`;
    try {
        await waitForHealthy(gatewayUrl, children);
    } catch (err) {
        await stop();
        throw err;
    }
    return { gatewayUrl, stop };
}

// The services run from source through tsx, but they import @notepad/shared's
// dist/ and their generated Prisma clients
function ensureBuilt() {
    if (!existsSync(path.join(REPO, "shared/dist/index.js"))) {
        execFileSync("npm", ["run", "build", "-w", "@notepad/shared"], { cwd: REPO, stdio: "pipe" });
    }
    for (const service of ["auth-service", "notes-service"]) {
        if (!existsSync(path.join(REPO, "services", service, "src/generated/prisma"))) {
            throw new Error(`Missing Prisma client for ${service}: run npm run db:generate -w ${service}`);
        }
    }
}

async function prepareDatabase(service: string, name: string) {
    if (!name.endsWith("_test")) throw new Error(`Refusing to reset "${name}": test database names must end in _test`);

    const server = new Client({ connectionString: `${testServerUrl}/postgres` });
    try {
        await server.connect();
    } catch (err) {
        throw new Error(
            `MCP integration tests need PostgreSQL at the server in TEST_POSTGRES_URL (default localhost:5432): ${String(err)}`,
            { cause: err },
        );
    }
    try {
        const { rowCount } = await server.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
        if (!rowCount) await server.query(`CREATE DATABASE "${name}"`);
    } finally {
        await server.end();
    }

    const databaseUrl = `${testServerUrl}/${name}`;
    try {
        execFileSync("npx", ["prisma", "migrate", "deploy"], {
            cwd: path.join(REPO, "services", service),
            env: { ...process.env, DATABASE_URL: databaseUrl },
            stdio: "pipe",
        });
    } catch (err) {
        const { stdout, stderr } = err as { stdout?: Buffer; stderr?: Buffer };
        throw new Error(`prisma migrate deploy failed for ${name}:\n${String(stdout)}${String(stderr)}`, {
            cause: err,
        });
    }

    const db = new Client({ connectionString: databaseUrl });
    await db.connect();
    try {
        const { rows } = await db.query<{ tablename: string }>(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'",
        );
        if (rows.length) await db.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(", ")} CASCADE`);
    } finally {
        await db.end();
    }
}

interface Child {
    name: string;
    process: ChildProcess;
    output: string[];
}

function startService(name: string, env: Record<string, string>): Child {
    const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
        cwd: path.join(REPO, "services", name),
        // Only what the service needs, so a developer's shell or .env can't change its behaviour
        env: { PATH: process.env["PATH"] ?? "", ...env },
        stdio: ["ignore", "pipe", "pipe"],
    });
    const output: string[] = [];
    const keep = (chunk: Buffer) => {
        output.push(chunk.toString());
        if (output.length > 50) output.shift();
    };
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);
    return { name, process: child, output };
}

async function waitForHealthy(gatewayUrl: string, children: Child[], timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const dead = children.find((c) => c.process.exitCode !== null);
        if (dead) throw new Error(`${dead.name} exited during startup:\n${dead.output.join("")}`);
        try {
            const res = await fetch(`${gatewayUrl}/health`);
            if (res.ok) return;
        } catch {
            // not listening yet
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(
        `Stack did not become healthy within ${timeoutMs / 1000}s:\n` +
            children.map((c) => `--- ${c.name}\n${c.output.join("")}`).join("\n"),
    );
}

function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.unref();
        server.on("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const { port } = server.address() as { port: number };
            server.close(() => resolve(port));
        });
    });
}

function stopChild(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
        const force = setTimeout(() => child.kill("SIGKILL"), 5000);
        child.once("exit", () => {
            clearTimeout(force);
            resolve();
        });
        child.kill("SIGTERM");
    });
}
