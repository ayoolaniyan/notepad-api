import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { type FakeUpstream, loadGateway, startFakeUpstream } from "./helpers";

let upstream: FakeUpstream;

beforeAll(async () => {
    upstream = await startFakeUpstream();
});

afterAll(async () => {
    await upstream.close();
});

// Each test loads its own gateway, so counters start at zero
const gatewayWith = (limits: Record<string, string>) =>
    loadGateway({ AUTH_SERVICE_URL: upstream.url, NOTES_SERVICE_URL: upstream.url, ...limits });

const login = (password: string) => ({ email: "a@example.com", password });

describe("global limit", () => {
    it("returns 429 with rate-limit headers once the limit is used up", async () => {
        const app = gatewayWith({ RATE_LIMIT_GLOBAL_MAX: "3" });
        for (let i = 0; i < 3; i++) {
            expect((await request(app).get("/api/v1/notes")).status).toBe(200);
        }

        const res = await request(app).get("/api/v1/notes");

        expect(res.status).toBe(429);
        expect(res.body).toEqual({ success: false, error: "Too many requests, please try again later" });
        expect(res.headers["ratelimit-limit"]).toBe("3");
        expect(res.headers["ratelimit-remaining"]).toBe("0");
        expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
    });

    it("counts down RateLimit-Remaining", async () => {
        const app = gatewayWith({ RATE_LIMIT_GLOBAL_MAX: "3" });

        const res = await request(app).get("/api/v1/notes");

        expect(res.headers["ratelimit-remaining"]).toBe("2");
    });

    it("exempts /health", async () => {
        const app = gatewayWith({ RATE_LIMIT_GLOBAL_MAX: "1" });
        await request(app).get("/api/v1/notes");

        expect((await request(app).get("/health")).status).toBe(200);
        expect((await request(app).get("/health")).status).toBe(200);
    });

    it("keeps CORS headers on 429 responses", async () => {
        const app = gatewayWith({ RATE_LIMIT_GLOBAL_MAX: "1" });
        await request(app).get("/api/v1/notes");

        const res = await request(app).get("/api/v1/notes").set("Origin", "http://localhost:5173");

        expect(res.status).toBe(429);
        expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    });
});

describe("login limit", () => {
    it("blocks after too many failed logins", async () => {
        const app = gatewayWith({ RATE_LIMIT_LOGIN_MAX: "2" });
        await request(app).post("/api/v1/auth/login").send(login("wrong"));
        await request(app).post("/api/v1/auth/login").send(login("wrong"));
        const before = upstream.requests.length;

        const res = await request(app).post("/api/v1/auth/login").send(login("right"));

        expect(res.status).toBe(429);
        expect(upstream.requests).toHaveLength(before);
    });

    it("doesn't count successful logins", async () => {
        const app = gatewayWith({ RATE_LIMIT_LOGIN_MAX: "2" });

        for (let i = 0; i < 4; i++) {
            expect((await request(app).post("/api/v1/auth/login").send(login("right"))).status).toBe(200);
        }
    });
});

describe("register and refresh limits", () => {
    it.each([
        ["register", "RATE_LIMIT_REGISTER_MAX"],
        ["refresh", "RATE_LIMIT_REFRESH_MAX"],
    ])("limit POST /api/v1/auth/%s", async (route, variable) => {
        const app = gatewayWith({ [variable]: "2" });
        await request(app).post(`/api/v1/auth/${route}`).send({});
        await request(app).post(`/api/v1/auth/${route}`).send({});

        expect((await request(app).post(`/api/v1/auth/${route}`).send({})).status).toBe(429);
        // Other auth routes aren't affected
        expect((await request(app).get("/api/v1/auth/me")).status).toBe(200);
    });
});
