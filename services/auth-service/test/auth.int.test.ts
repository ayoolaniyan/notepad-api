import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../src/app";
import { config } from "../src/config";
import { prisma } from "../src/database";
import { deleteExpiredRefreshTokens } from "../src/services/auth.service";
import { hashRefreshToken } from "../src/utils/tokens";

const app = createApp();
const PASSWORD = "Secret123";

// Every test uses its own email, so tests never share rows and can run in any order
const uniqueEmail = () => `user-${randomUUID()}@example.com`;

async function register(email = uniqueEmail()) {
    const res = await request(app).post("/auth/register").send({ email, password: PASSWORD });
    expect(res.status).toBe(201);
    return { email, ...(res.body.data as { user: { id: string }; accessToken: string; refreshToken: string }) };
}

const login = (email: string, password = PASSWORD) => request(app).post("/auth/login").send({ email, password });
const refresh = (refreshToken: string) => request(app).post("/auth/refresh").send({ refreshToken });

afterAll(async () => {
    await prisma.$disconnect();
});

describe("GET /health", () => {
    it("reports the database as reachable", async () => {
        const res = await request(app).get("/health");

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ service: "auth-service", status: "ok", database: true });
    });
});

describe("POST /auth/register", () => {
    it("creates the account and returns tokens without the password hash", async () => {
        const email = uniqueEmail();

        const res = await request(app).post("/auth/register").send({ email, password: PASSWORD });

        expect(res.status).toBe(201);
        expect(res.body.message).toBe("Account created");
        expect(res.body.data).toMatchObject({
            user: { id: expect.any(String), email },
            accessToken: expect.any(String),
            refreshToken: expect.any(String),
            tokenType: "Bearer",
            expiresIn: config.jwt.accessTtlSeconds,
        });
        expect(res.body.data.user).not.toHaveProperty("password");

        const stored = await prisma.user.findUniqueOrThrow({ where: { email } });
        expect(stored.password).toMatch(/^scrypt\$/);
    });

    it("stores the email in lower case and rejects a duplicate in any case", async () => {
        const email = uniqueEmail();
        await register(email);

        const res = await request(app).post("/auth/register").send({ email: email.toUpperCase(), password: PASSWORD });

        expect(res.status).toBe(409);
        expect(res.body.error).toBe("An account with this email already exists");
    });

    it("returns 400 with field errors for invalid input", async () => {
        const res = await request(app).post("/auth/register").send({ email: "nope", password: "short" });

        expect(res.status).toBe(400);
        expect(Object.keys(res.body.errors).sort()).toEqual(["email", "password"]);
    });

    it("returns 400 for malformed JSON", async () => {
        const res = await request(app).post("/auth/register").set("Content-Type", "application/json").send("{");

        expect(res.status).toBe(400);
    });
});

describe("POST /auth/login", () => {
    it("returns the user and a fresh token pair", async () => {
        const { email, user } = await register();

        const res = await login(email);

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ user: { id: user.id, email }, tokenType: "Bearer" });
        expect(res.body.data.user).not.toHaveProperty("password");
    });

    it("gives the same 401 for a wrong password and an unknown email", async () => {
        const { email } = await register();

        const wrongPassword = await login(email, "Wrong1234");
        const unknownEmail = await login(uniqueEmail());

        expect(wrongPassword.status).toBe(401);
        expect(unknownEmail.status).toBe(401);
        expect(wrongPassword.body).toEqual(unknownEmail.body);
    });

    it("locks the account after too many failures, even for the right password", async () => {
        const { email } = await register();
        for (let i = 0; i < config.loginThrottle.maxFailures; i++) {
            expect((await login(email, "Wrong1234")).status).toBe(401);
        }

        const res = await login(email);

        expect(res.status).toBe(429);
        expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
    });

    it("locks unknown emails the same way, so lockouts don't reveal which emails exist", async () => {
        const email = uniqueEmail();
        for (let i = 0; i < config.loginThrottle.maxFailures; i++) await login(email, "Wrong1234");

        expect((await login(email)).status).toBe(429);
    });

    it("resets the failure count after a successful login", async () => {
        const { email } = await register();
        for (let i = 0; i < config.loginThrottle.maxFailures - 1; i++) await login(email, "Wrong1234");
        expect((await login(email)).status).toBe(200);

        for (let i = 0; i < config.loginThrottle.maxFailures - 1; i++) await login(email, "Wrong1234");

        expect((await login(email)).status).toBe(200);
    });
});

describe("POST /auth/refresh", () => {
    it("rotates the refresh token", async () => {
        const { refreshToken } = await register();

        const res = await refresh(refreshToken);

        expect(res.status).toBe(200);
        expect(res.body.data.refreshToken).not.toBe(refreshToken);
        expect((await refresh(refreshToken)).status).toBe(401);
    });

    it("revokes every session when a used refresh token is replayed", async () => {
        const { refreshToken: stolen } = await register();
        const { refreshToken: current } = (await refresh(stolen)).body.data;

        expect((await refresh(stolen)).status).toBe(401);

        expect((await refresh(current)).status).toBe(401);
    });

    it("lets only one of two concurrent requests with the same token succeed", async () => {
        const { refreshToken } = await register();

        const results = await Promise.all([refresh(refreshToken), refresh(refreshToken)]);

        expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    });

    it("rejects an expired refresh token", async () => {
        const { refreshToken } = await register();
        await prisma.refreshToken.update({
            where: { tokenHash: hashRefreshToken(refreshToken) },
            data: { expiresAt: new Date(Date.now() - 1000) },
        });

        const res = await refresh(refreshToken);

        expect(res.status).toBe(401);
        expect(res.body.error).toBe("Refresh token expired");
    });

    it("rejects an unknown refresh token", async () => {
        expect((await refresh("not-a-real-token")).status).toBe(401);
    });
});

describe("POST /auth/logout", () => {
    it("revokes the refresh token", async () => {
        const { refreshToken } = await register();

        const res = await request(app).post("/auth/logout").send({ refreshToken });

        expect(res.status).toBe(200);
        expect((await refresh(refreshToken)).status).toBe(401);
    });

    it("succeeds for an unknown token", async () => {
        const res = await request(app).post("/auth/logout").send({ refreshToken: "never-issued" });

        expect(res.status).toBe(200);
    });
});

describe("POST /auth/logout-all", () => {
    it("revokes every session of the caller and no one else's", async () => {
        const { email, accessToken, refreshToken: first } = await register();
        const { refreshToken: second } = (await login(email)).body.data;
        const other = await register();

        const res = await request(app).post("/auth/logout-all").set("Authorization", `Bearer ${accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Logged out of all devices");
        expect((await refresh(first)).status).toBe(401);
        expect((await refresh(second)).status).toBe(401);
        expect((await refresh(other.refreshToken)).status).toBe(200);
    });

    it("returns 401 without a token", async () => {
        expect((await request(app).post("/auth/logout-all")).status).toBe(401);
    });
});

describe("expired refresh token cleanup", () => {
    const tokenExists = async (token: string) =>
        (await prisma.refreshToken.count({ where: { tokenHash: hashRefreshToken(token) } })) === 1;

    it("deletes expired tokens, revoked or not, and keeps unexpired revoked ones for reuse detection", async () => {
        const { refreshToken: expired } = await register();
        const { refreshToken: expiredRevoked } = await register();
        const { refreshToken: revoked } = await register();
        const { refreshToken: active } = await register();
        const past = new Date(Date.now() - 1000);
        await prisma.refreshToken.update({
            where: { tokenHash: hashRefreshToken(expired) },
            data: { expiresAt: past },
        });
        await prisma.refreshToken.update({
            where: { tokenHash: hashRefreshToken(expiredRevoked) },
            data: { expiresAt: past, revokedAt: past },
        });
        await request(app).post("/auth/logout").send({ refreshToken: revoked });

        expect(await deleteExpiredRefreshTokens()).toBeGreaterThanOrEqual(2);

        expect(await tokenExists(expired)).toBe(false);
        expect(await tokenExists(expiredRevoked)).toBe(false);
        expect(await tokenExists(revoked)).toBe(true);
        expect(await tokenExists(active)).toBe(true);
    });
});

describe("GET /auth/me", () => {
    it("returns the caller's profile", async () => {
        const { email, user, accessToken } = await register();

        const res = await request(app).get("/auth/me").set("Authorization", `Bearer ${accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.data.user).toMatchObject({ id: user.id, email });
    });

    it("returns 401 without a token", async () => {
        expect((await request(app).get("/auth/me")).status).toBe(401);
    });

    it("returns 404 when the account no longer exists", async () => {
        const { user, accessToken } = await register();
        await prisma.user.delete({ where: { id: user.id } });

        const res = await request(app).get("/auth/me").set("Authorization", `Bearer ${accessToken}`);

        expect(res.status).toBe(404);
    });
});

describe("unknown routes", () => {
    it("return 404 in the response envelope", async () => {
        const res = await request(app).get("/auth/nope");

        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
    });
});
