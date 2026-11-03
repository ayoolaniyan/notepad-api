import { describe, expect, it } from "@jest/globals";
import { json } from "../test/fake-gateway";
import { ApiClient, ApiError, FetchFn } from "./http";

const BASE = "http://gateway.test";

describe("ApiClient", () => {
    it("unwraps the envelope and sends the Bearer token and query", async () => {
        let seen: { url: string; auth: string | null } | undefined;
        const fetchFn: FetchFn = (input, init) => {
            seen = { url: (input as URL).href, auth: new Headers(init?.headers).get("authorization") };
            return Promise.resolve(json(200, { success: true, data: { ok: 1 } }));
        };

        const data = await new ApiClient(BASE, fetchFn).request("GET", "/notes", {
            token: "tok",
            query: { q: "milk", limit: 5, cursor: undefined },
        });

        expect(data).toEqual({ ok: 1 });
        expect(seen).toEqual({ url: `${BASE}/api/v1/notes?q=milk&limit=5`, auth: "Bearer tok" });
    });

    it("keeps the status, field errors and Retry-After of a failed response", async () => {
        const fetchFn: FetchFn = () =>
            Promise.resolve(
                json(400, { success: false, error: "Validation failed", errors: { title: ["Title is required"] } }),
            );

        await expect(new ApiClient(BASE, fetchFn).request("POST", "/notes")).rejects.toMatchObject({
            kind: "http",
            status: 400,
            message: "Validation failed",
            fieldErrors: { title: ["Title is required"] },
        });
    });

    it("reads Retry-After, falling back to RateLimit-Reset", async () => {
        const withHeaders = (headers: Record<string, string>) =>
            new ApiClient(BASE, () =>
                Promise.resolve(json(429, { success: false, error: "Too many" }, headers)),
            ).request("GET", "/notes");

        await expect(withHeaders({ "Retry-After": "12" })).rejects.toMatchObject({ retryAfterSeconds: 12 });
        await expect(withHeaders({ "RateLimit-Reset": "3" })).rejects.toMatchObject({ retryAfterSeconds: 3 });
        await expect(withHeaders({})).rejects.toMatchObject({ retryAfterSeconds: undefined });
    });

    it("handles a non-JSON error body", async () => {
        const fetchFn: FetchFn = () => Promise.resolve(new Response("<html>bad gateway</html>", { status: 502 }));

        await expect(new ApiClient(BASE, fetchFn).request("GET", "/notes")).rejects.toMatchObject({
            status: 502,
            message: "HTTP 502",
        });
    });

    it("times out a request that never answers", async () => {
        const hang: FetchFn = (_input, init) =>
            new Promise((_resolve, reject) => {
                init?.signal?.addEventListener("abort", () => reject(init.signal?.reason as Error));
            });

        const error = await new ApiClient(BASE, hang, 20).request("GET", "/notes").catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ApiError);
        expect(error).toMatchObject({ kind: "timeout", status: 0 });
    });

    it("maps a refused connection to a readable network error", async () => {
        const refuse: FetchFn = () =>
            Promise.reject(new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } }));

        await expect(new ApiClient(BASE, refuse).request("GET", "/notes")).rejects.toMatchObject({
            kind: "network",
            message: `Could not reach notepad-api at ${BASE} (ECONNREFUSED)`,
        });
    });
});
