import { describe, expect, it } from "@jest/globals";
import { verifyAccessToken } from "@notepad/shared";
import { config } from "../config";
import { generateRefreshToken, hashRefreshToken, signAccessToken } from "./tokens";

describe("signAccessToken", () => {
    it("produces a token the shared verifier accepts", () => {
        const token = signAccessToken({ sub: "user-1", email: "a@example.com" });

        expect(verifyAccessToken(token, { secret: config.jwt.accessSecret, issuer: config.jwt.issuer })).toEqual({
            sub: "user-1",
            email: "a@example.com",
        });
    });
});

describe("refresh tokens", () => {
    it("are 256-bit random base64url strings", () => {
        const a = generateRefreshToken();

        expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(generateRefreshToken()).not.toBe(a);
    });

    it("hash to a stable SHA-256 hex digest", () => {
        const token = generateRefreshToken();

        expect(hashRefreshToken(token)).toMatch(/^[0-9a-f]{64}$/);
        expect(hashRefreshToken(token)).toBe(hashRefreshToken(token));
        expect(hashRefreshToken(token)).not.toBe(token);
    });
});
