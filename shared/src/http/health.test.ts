import { describe, expect, it } from "@jest/globals";
import express from "express";
import request from "supertest";
import { createHealthHandler } from "./health";

function appWith(checkDatabase: () => Promise<unknown>) {
    const app = express();
    app.get("/health", createHealthHandler({ service: "test-service", checkDatabase, timeoutMs: 50 }));
    return app;
}

describe("createHealthHandler", () => {
    it("returns 200 when the database answers", async () => {
        const res = await request(appWith(() => Promise.resolve())).get("/health");

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            success: true,
            data: { service: "test-service", status: "ok", database: true },
        });
    });

    it("returns 503 when the database check fails", async () => {
        const res = await request(appWith(() => Promise.reject(new Error("down")))).get("/health");

        expect(res.status).toBe(503);
        expect(res.body.data).toEqual({ service: "test-service", status: "degraded", database: false });
    });

    it("returns 503 instead of hanging when the database doesn't answer in time", async () => {
        const res = await request(appWith(() => new Promise(() => {}))).get("/health");

        expect(res.status).toBe(503);
    });
});
