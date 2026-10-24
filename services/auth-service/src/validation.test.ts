import { describe, expect, it } from "@jest/globals";
import { loginSchema, registerSchema } from "./validation";

describe("registerSchema", () => {
    it("normalises the email", () => {
        const { value, error } = registerSchema.validate({ email: "  Ada@Example.COM ", password: "Secret123" });

        expect(error).toBeUndefined();
        expect(value.email).toBe("ada@example.com");
    });

    it.each([
        ["too short", "Ab1"],
        ["no uppercase letter", "secret123"],
        ["no lowercase letter", "SECRET123"],
        ["no number", "SecretPass"],
        ["too long", `Aa1${"x".repeat(126)}`],
    ])("rejects a password that is %s", (_name, password) => {
        expect(registerSchema.validate({ email: "a@example.com", password }).error).toBeDefined();
    });

    it("rejects an invalid email", () => {
        expect(registerSchema.validate({ email: "not-an-email", password: "Secret123" }).error).toBeDefined();
    });
});

describe("loginSchema", () => {
    // Old accounts may predate the current password policy, so login only checks presence and length
    it("accepts any password up to 128 characters", () => {
        expect(loginSchema.validate({ email: "a@example.com", password: "weak" }).error).toBeUndefined();
    });
});
