import { describe, expect, it } from "@jest/globals";
import { createFakeGateway, FAKE_PASSWORD, json } from "../test/fake-gateway";
import { AuthError, AuthManager } from "./auth";
import { ApiClient, ApiError } from "./http";

const BASE = "http://gateway.test";

function setup({ password = FAKE_PASSWORD, now = Date.now } = {}) {
    const gateway = createFakeGateway();
    const api = new ApiClient(BASE, gateway.fetch);
    const auth = new AuthManager(api, { email: "user@example.com", password }, { now });
    const listNotes = () => auth.call((token) => api.request("GET", "/notes", { token }));
    return { gateway, auth, listNotes };
}

describe("AuthManager", () => {
    it("logs in lazily on the first call, then reuses the session", async () => {
        const { gateway, listNotes } = setup();
        expect(gateway.state.logins).toBe(0);

        await listNotes();
        await listNotes();

        expect(gateway.state.logins).toBe(1);
        expect(gateway.state.refreshTokensUsed).toEqual([]);
    });

    it("logs in once for many concurrent first calls", async () => {
        const { gateway, listNotes } = setup();

        await Promise.all(Array.from({ length: 5 }, listNotes));

        expect(gateway.state.logins).toBe(1);
    });

    it("refreshes once and retries once when the access token is rejected", async () => {
        const { gateway, listNotes } = setup();
        await listNotes();
        gateway.expireAccessTokens();

        await listNotes();

        expect(gateway.state.refreshTokensUsed).toEqual(["refresh-1"]);
        expect(gateway.state.logins).toBe(1);
    });

    it("runs exactly one refresh when concurrent calls all get a 401, and never reuses a refresh token", async () => {
        const { gateway, listNotes } = setup();
        await listNotes();
        gateway.expireAccessTokens();

        const results = await Promise.allSettled(Array.from({ length: 8 }, listNotes));

        expect(results.every((r) => r.status === "fulfilled")).toBe(true);
        expect(gateway.state.refreshTokensUsed).toEqual(["refresh-1"]);
        expect(gateway.state.reuseDetected).toBe(false);
        expect(gateway.state.logins).toBe(1);
    });

    it("does not refresh again for a 401 that arrives after another call already refreshed", async () => {
        const { gateway, listNotes } = setup();
        await listNotes();
        gateway.expireAccessTokens();

        // The first call's 401 is held back until a second call has refreshed and succeeded
        let release!: () => void;
        const held = new Promise<void>((resolve) => (release = resolve));
        let holdNext = true;
        gateway.state.override = async (req) => {
            if (holdNext && req.path === "/api/v1/notes") {
                holdNext = false;
                await held;
                return json(401, { success: false, error: "Invalid or expired access token" });
            }
            return undefined;
        };
        const slow = listNotes();
        await listNotes();
        release();
        await slow;

        const uniqueTokens = new Set(gateway.state.refreshTokensUsed);
        expect(gateway.state.refreshTokensUsed).toEqual(["refresh-1"]);
        expect(uniqueTokens.size).toBe(gateway.state.refreshTokensUsed.length);
        expect(gateway.state.reuseDetected).toBe(false);
    });

    it("falls back to one fresh login when the refresh token is rejected", async () => {
        const { gateway, listNotes } = setup();
        await listNotes();
        gateway.expireAccessTokens();
        gateway.state.liveRefreshTokens.clear(); // e.g. revoked by "log out of all devices"

        await listNotes();

        expect(gateway.state.refreshTokensUsed).toEqual(["refresh-1"]);
        expect(gateway.state.logins).toBe(2);
    });

    it("gives up with an auth error instead of looping when every attempt is rejected", async () => {
        const { gateway, listNotes } = setup();
        await listNotes();
        gateway.state.override = (req) =>
            req.path === "/api/v1/notes" ? json(401, { success: false, error: "Invalid token" }) : undefined;

        await expect(listNotes()).rejects.toBeInstanceOf(AuthError);

        // first try, one refresh, one retry: nothing more
        expect(gateway.state.requests.filter((r) => r.path === "/api/v1/notes")).toHaveLength(3);
        expect(gateway.state.refreshTokensUsed).toHaveLength(1);
        expect(gateway.state.logins).toBe(1);
    });

    it("stops logging in after the password is rejected, to avoid tripping the lockout", async () => {
        const { gateway, listNotes } = setup({ password: "wrong-placeholder" });

        await expect(listNotes()).rejects.toThrow(/rejected NOTEPAD_EMAIL\/NOTEPAD_PASSWORD/);
        await expect(listNotes()).rejects.toBeInstanceOf(AuthError);

        expect(gateway.state.logins).toBe(1);
    });

    it("refreshes ahead of expiry instead of waiting for a 401", async () => {
        let clock = 1_000_000;
        const { gateway, listNotes } = setup({ now: () => clock });
        await listNotes();

        clock += (900 - 20) * 1000; // inside the 30 s margin
        await listNotes();

        expect(gateway.state.refreshTokensUsed).toEqual(["refresh-1"]);
        // No request was sent with a token the manager knew was about to expire
        expect(gateway.state.requests.filter((r) => r.path === "/api/v1/notes")).toHaveLength(2);
    });

    it("passes a 429 from refresh through without logging in", async () => {
        const { gateway, listNotes } = setup();
        await listNotes();
        gateway.expireAccessTokens();
        gateway.state.override = (req) =>
            req.path === "/api/v1/auth/refresh"
                ? json(429, { success: false, error: "Too many requests" }, { "Retry-After": "7" })
                : undefined;

        await expect(listNotes()).rejects.toMatchObject({ status: 429, retryAfterSeconds: 7 });
        expect(gateway.state.logins).toBe(1);
    });

    it("does not retry non-auth errors", async () => {
        const { gateway, listNotes } = setup();
        gateway.state.override = (req) =>
            req.path === "/api/v1/notes" ? json(503, { success: false, error: "Service unavailable" }) : undefined;

        await expect(listNotes()).rejects.toBeInstanceOf(ApiError);
        expect(gateway.state.requests.filter((r) => r.path === "/api/v1/notes")).toHaveLength(1);
    });

    it("revokes the refresh token on logout", async () => {
        const { gateway, auth, listNotes } = setup();
        await listNotes();

        await auth.logout();

        expect(gateway.state.revokedRefreshTokens.has("refresh-1")).toBe(true);
    });
});
