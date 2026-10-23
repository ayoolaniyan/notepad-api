// Runs before each test file. Every variable config.ts reads is set here, so a developer's
// .env (which dotenv never lets override existing values) can't change test behaviour.
// Tests that need fake upstreams or other limits override these before loading the app.
Object.assign(process.env, {
    NODE_ENV: "test",
    DOTENV_CONFIG_QUIET: "true",
    AUTH_SERVICE_URL: "http://127.0.0.1:1",
    NOTES_SERVICE_URL: "http://127.0.0.1:1",
    UPSTREAM_TIMEOUT_MS: "10000",
    CORS_ORIGINS: "http://localhost:5173",
    TRUST_PROXY: "0",
    MAX_BODY_BYTES: String(1024 * 1024),
    RATE_LIMIT_GLOBAL_MAX: "1000",
    RATE_LIMIT_GLOBAL_WINDOW_MS: "60000",
    RATE_LIMIT_LOGIN_MAX: "1000",
    RATE_LIMIT_LOGIN_WINDOW_MS: "60000",
    RATE_LIMIT_REGISTER_MAX: "1000",
    RATE_LIMIT_REGISTER_WINDOW_MS: "60000",
    RATE_LIMIT_REFRESH_MAX: "1000",
    RATE_LIMIT_REFRESH_WINDOW_MS: "60000",
});
delete process.env["HOST"];
