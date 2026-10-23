// Integration tests use their own database on the server given by TEST_POSTGRES_URL.
// The name must end in _test: global-setup wipes it before every run.
export const TEST_DATABASE_NAME = "notepad_notes_test";

export const testServerUrl = process.env["TEST_POSTGRES_URL"] ?? "postgresql://postgres:postgres@localhost:5432";

export const testDatabaseUrl = `${testServerUrl.replace(/\/$/, "")}/${TEST_DATABASE_NAME}`;
