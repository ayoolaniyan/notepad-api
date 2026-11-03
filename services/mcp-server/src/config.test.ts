import { describe, expect, it } from "@jest/globals";
import { ConfigError, loadConfig } from "./config";

describe("loadConfig", () => {
    it("reads the settings and defaults the API URL", () => {
        expect(loadConfig({ NOTEPAD_EMAIL: "a@example.com", NOTEPAD_PASSWORD: "placeholder" })).toEqual({
            apiUrl: "http://localhost:3000",
            email: "a@example.com",
            password: "placeholder",
        });
    });

    it("strips a trailing slash from the API URL", () => {
        const config = loadConfig({
            NOTEPAD_API_URL: "https://notes.example.com/",
            NOTEPAD_EMAIL: "a@example.com",
            NOTEPAD_PASSWORD: "placeholder",
        });

        expect(config.apiUrl).toBe("https://notes.example.com");
    });

    it("lists every problem without echoing any value", () => {
        const env = { NOTEPAD_API_URL: "ftp://secret-host", NOTEPAD_EMAIL: "not-an-email", NOTEPAD_PASSWORD: "" };

        let error: unknown;
        try {
            loadConfig(env);
        } catch (e) {
            error = e;
        }

        expect(error).toBeInstanceOf(ConfigError);
        const { problems, message } = error as ConfigError;
        expect(problems).toHaveLength(3);
        expect(problems.join(" ")).toMatch(/NOTEPAD_API_URL.*NOTEPAD_EMAIL.*NOTEPAD_PASSWORD/);
        expect(message).not.toContain("secret-host");
        expect(message).not.toContain("not-an-email");
    });
});
