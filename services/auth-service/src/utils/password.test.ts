import { describe, expect, it } from "@jest/globals";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
    it("stores the algorithm and parameters alongside a random salt", async () => {
        const [a, b] = await Promise.all([hashPassword("Secret123"), hashPassword("Secret123")]);

        expect(a).toMatch(/^scrypt\$32768\$8\$3\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
        expect(a).not.toBe(b);
    });

    it("verifies the right password and rejects a wrong one", async () => {
        const hash = await hashPassword("Secret123");

        await expect(verifyPassword("Secret123", hash)).resolves.toBe(true);
        await expect(verifyPassword("secret123", hash)).resolves.toBe(false);
    });

    it.each(["", "not-a-hash", "bcrypt$10$abc", "scrypt$32768$8$3$$"])(
        "rejects a malformed hash %p",
        async (stored) => {
            await expect(verifyPassword("Secret123", stored)).resolves.toBe(false);
        },
    );
});
