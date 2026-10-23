import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import type { Express } from "express";
import request from "supertest";
import { type FakeUpstream, loadGateway, startFakeUpstream, unusedUrl } from "./helpers";

const ALLOWED_ORIGIN = "http://localhost:5173";

let auth: FakeUpstream;
let notes: FakeUpstream;
let app: Express;

beforeAll(async () => {
    [auth, notes] = await Promise.all([startFakeUpstream(), startFakeUpstream()]);
    app = loadGateway({
        AUTH_SERVICE_URL: auth.url,
        NOTES_SERVICE_URL: notes.url,
        UPSTREAM_TIMEOUT_MS: "200",
        MAX_BODY_BYTES: "2048",
    });
});

beforeEach(() => {
    auth.requests.length = 0;
    notes.requests.length = 0;
});

afterAll(async () => {
    await Promise.all([auth.close(), notes.close()]);
});

describe("routing", () => {
    it.each([
        ["/api/v1/auth/me", "auth", "/auth/me"],
        ["/api/v1/auth/refresh", "auth", "/auth/refresh"],
        ["/api/v1/notes", "notes", "/notes"],
        ["/api/v1/notes/abc?limit=5&q=milk", "notes", "/notes/abc?limit=5&q=milk"],
    ])("forwards %s to the %s service as %s", async (path, service, upstreamUrl) => {
        const res = await request(app).get(path);

        expect(res.status).toBe(200);
        const upstream = service === "auth" ? auth : notes;
        expect(upstream.requests.map((r) => r.url)).toEqual([upstreamUrl]);
    });

    it("streams the request body and method through unchanged", async () => {
        const body = JSON.stringify({ title: "Hello" });

        await request(app).patch("/api/v1/notes/abc").set("Content-Type", "application/json").send(body);

        expect(notes.requests[0]).toMatchObject({ method: "PATCH", body });
    });

    it("forwards the Authorization header and the client address", async () => {
        await request(app).get("/api/v1/notes").set("Authorization", "Bearer token-123");

        expect(notes.requests[0]?.headers["authorization"]).toBe("Bearer token-123");
        expect(notes.requests[0]?.headers["x-forwarded-for"]).toBeDefined();
    });

    it("returns 404 in the envelope for paths outside /api/v1", async () => {
        const res = await request(app).get("/api/v2/notes");

        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
        expect(notes.requests).toHaveLength(0);
    });
});

describe("request ids", () => {
    it("generates an id, forwards it upstream and returns it", async () => {
        const res = await request(app).get("/api/v1/notes");

        const id = res.headers["x-request-id"];
        expect(id).toMatch(/^[0-9a-f-]{36}$/);
        expect(notes.requests[0]?.headers["x-request-id"]).toBe(id);
    });

    it("keeps a valid client-supplied id", async () => {
        const res = await request(app).get("/api/v1/notes").set("X-Request-Id", "client-id-1234");

        expect(res.headers["x-request-id"]).toBe("client-id-1234");
        expect(notes.requests[0]?.headers["x-request-id"]).toBe("client-id-1234");
    });

    it.each(["short", "has spaces in it", "x".repeat(129)])("replaces an unsafe client id %p", async (id) => {
        const res = await request(app).get("/api/v1/notes").set("X-Request-Id", id);

        expect(res.headers["x-request-id"]).not.toBe(id);
    });
});

describe("security headers", () => {
    it("sets helmet headers and hides the upstream's x-powered-by", async () => {
        const res = await request(app).get("/api/v1/notes");

        expect(res.headers["content-security-policy"]).toBe("default-src 'none';frame-ancestors 'none'");
        expect(res.headers["x-content-type-options"]).toBe("nosniff");
        expect(res.headers["referrer-policy"]).toBe("no-referrer");
        expect(res.headers["x-powered-by"]).toBeUndefined();
        // HSTS is production-only
        expect(res.headers["strict-transport-security"]).toBeUndefined();
    });

    it("marks auth responses as not cacheable", async () => {
        const authRes = await request(app).get("/api/v1/auth/me");
        const notesRes = await request(app).get("/api/v1/notes");

        expect(authRes.headers["cache-control"]).toBe("no-store");
        expect(notesRes.headers["cache-control"]).toBeUndefined();
    });
});

describe("CORS", () => {
    it("allows listed origins", async () => {
        const res = await request(app).get("/api/v1/notes").set("Origin", ALLOWED_ORIGIN);

        expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
        expect(res.headers["access-control-expose-headers"]).toContain("X-Request-Id");
    });

    it("sends no CORS headers to other origins", async () => {
        const res = await request(app).get("/api/v1/notes").set("Origin", "https://evil.example.com");

        expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("answers preflights without contacting the service", async () => {
        const res = await request(app)
            .options("/api/v1/notes")
            .set("Origin", ALLOWED_ORIGIN)
            .set("Access-Control-Request-Method", "PATCH")
            .set("Access-Control-Request-Headers", "Authorization, Content-Type");

        expect(res.status).toBe(204);
        expect(res.headers["access-control-allow-methods"]).toBe("GET,POST,PATCH,DELETE");
        expect(res.headers["access-control-allow-headers"]).toBe("Authorization,Content-Type,X-Request-Id");
        expect(notes.requests).toHaveLength(0);
    });
});

describe("body size limit", () => {
    it("rejects a body over MAX_BODY_BYTES with 413 before contacting the service", async () => {
        const res = await request(app)
            .post("/api/v1/notes")
            .set("Content-Type", "application/json")
            .send(JSON.stringify({ content: "x".repeat(3000) }));

        expect(res.status).toBe(413);
        expect(res.body).toEqual({ success: false, error: "Request body too large" });
        expect(notes.requests).toHaveLength(0);
    });
});

describe("upstream failures", () => {
    it("returns 504 when a service is too slow", async () => {
        const res = await request(app).get("/api/v1/notes/slow");

        expect(res.status).toBe(504);
        expect(res.body).toEqual({ success: false, error: "Service timed out" });
    });

    it("returns 502 when a service is down", async () => {
        const gateway = loadGateway({ NOTES_SERVICE_URL: await unusedUrl() });

        const res = await request(gateway).get("/api/v1/notes");

        expect(res.status).toBe(502);
        expect(res.body).toEqual({ success: false, error: "Service unavailable" });
        expect(res.headers["x-request-id"]).toBeDefined();
    });
});

describe("GET /health", () => {
    it("returns 200 when every service is healthy", async () => {
        const gateway = loadGateway({ AUTH_SERVICE_URL: auth.url, NOTES_SERVICE_URL: notes.url });

        const res = await request(gateway).get("/health");

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({
            service: "api-gateway",
            status: "ok",
            upstreams: { auth: "ok", notes: "ok" },
        });
    });

    it("returns 503 naming the service that is down", async () => {
        const gateway = loadGateway({ AUTH_SERVICE_URL: auth.url, NOTES_SERVICE_URL: await unusedUrl() });

        const res = await request(gateway).get("/health");

        expect(res.status).toBe(503);
        expect(res.body.data.upstreams).toEqual({ auth: "ok", notes: "down" });
    });
});
