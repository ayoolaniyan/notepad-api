import { testDatabaseUrl } from "./database-url";

// Runs before each test file. Every variable config.ts reads is set here, so a developer's
// .env (which dotenv never lets override existing values) can't change test behaviour.
Object.assign(process.env, {
    NODE_ENV: "test",
    DOTENV_CONFIG_QUIET: "true",
    DATABASE_URL: testDatabaseUrl,
    JWT_ACCESS_SECRET: "test-access-secret-that-is-at-least-32-chars",
    JWT_ISSUER: "notepad-auth-service",
});
delete process.env["HOST"];
