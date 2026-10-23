import { execFileSync } from "node:child_process";
import path from "node:path";
import { Client } from "pg";
import { TEST_DATABASE_NAME, testDatabaseUrl, testServerUrl } from "./database-url";

// Runs once before the integration tests: creates the test database if needed,
// applies migrations and empties every table.
export default async function globalSetup(): Promise<void> {
    if (!TEST_DATABASE_NAME.endsWith("_test")) {
        throw new Error(`Refusing to reset "${TEST_DATABASE_NAME}": test database names must end in _test`);
    }

    const server = new Client({ connectionString: `${testServerUrl.replace(/\/$/, "")}/postgres` });
    try {
        await server.connect();
    } catch (err) {
        throw new Error(
            `Integration tests need PostgreSQL at ${testServerUrl} (set TEST_POSTGRES_URL to change it): ${String(err)}`,
            { cause: err },
        );
    }
    try {
        const { rowCount } = await server.query("SELECT 1 FROM pg_database WHERE datname = $1", [TEST_DATABASE_NAME]);
        if (!rowCount) await server.query(`CREATE DATABASE "${TEST_DATABASE_NAME}"`);
    } finally {
        await server.end();
    }

    try {
        execFileSync("npx", ["prisma", "migrate", "deploy"], {
            cwd: path.resolve(__dirname, ".."),
            env: { ...process.env, DATABASE_URL: testDatabaseUrl },
            stdio: "pipe",
        });
    } catch (err) {
        const { stdout, stderr } = err as { stdout?: Buffer; stderr?: Buffer };
        throw new Error(`prisma migrate deploy failed:\n${String(stdout)}${String(stderr)}`, { cause: err });
    }

    const db = new Client({ connectionString: testDatabaseUrl });
    await db.connect();
    try {
        const { rows } = await db.query<{ tablename: string }>(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'",
        );
        if (rows.length) {
            await db.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(", ")} CASCADE`);
        }
    } finally {
        await db.end();
    }
}
