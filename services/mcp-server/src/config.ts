import { z } from "zod";

export interface Config {
    apiUrl: string;
    email: string;
    password: string;
}

const envSchema = z.object({
    NOTEPAD_API_URL: z
        .url({ protocol: /^https?$/, error: "must be an http:// or https:// URL" })
        .default("http://localhost:3000"),
    NOTEPAD_EMAIL: z.email({ error: "must be set to the account's email address" }),
    NOTEPAD_PASSWORD: z.string({ error: "must be set" }).min(1, { error: "must be set" }),
});

export class ConfigError extends Error {
    constructor(public readonly problems: string[]) {
        super(`Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
        this.name = "ConfigError";
    }
}

// Reads the server's settings from the environment. Error messages name the variable and the
// problem but never repeat its value, so a password can't end up in a client's log.
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
    // Treat blank values (as left by a copied .env.example) as unset
    const values = Object.fromEntries(
        ["NOTEPAD_API_URL", "NOTEPAD_EMAIL", "NOTEPAD_PASSWORD"].map((key) => [key, env[key] || undefined]),
    );
    const result = envSchema.safeParse(values);
    if (!result.success) {
        throw new ConfigError(result.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`));
    }
    return {
        apiUrl: result.data.NOTEPAD_API_URL.replace(/\/+$/, ""),
        email: result.data.NOTEPAD_EMAIL,
        password: result.data.NOTEPAD_PASSWORD,
    };
}
