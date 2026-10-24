import { describe, expect, it, jest } from "@jest/globals";
import express from "express";
import request from "supertest";
import { AppError } from "./errors";
import { createErrorHandler, notFoundHandler } from "./errorHandler";

function appThrowing(err: unknown, exposeDetails = true, log = jest.fn()) {
    const app = express();
    app.use(express.json({ limit: "10b" }));
    app.post("/echo", (req, res) => {
        res.json(req.body);
    });
    app.get("/boom", () => {
        throw err;
    });
    app.use(notFoundHandler);
    app.use(createErrorHandler({ exposeDetails, log }));
    return { app, log };
}

describe("createErrorHandler", () => {
    it("renders an AppError with its status, field errors and headers", async () => {
        const { app, log } = appThrowing(
            new AppError(429, "Slow down", { email: ["Too many"] }, { "Retry-After": "30" }),
        );

        const res = await request(app).get("/boom");

        expect(res.status).toBe(429);
        expect(res.headers["retry-after"]).toBe("30");
        expect(res.body).toEqual({ success: false, error: "Slow down", errors: { email: ["Too many"] } });
        expect(log).not.toHaveBeenCalled();
    });

    it("returns 400 for malformed JSON", async () => {
        const { app } = appThrowing(undefined);

        const res = await request(app).post("/echo").set("Content-Type", "application/json").send("{bad");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 413 for a body over the parser limit", async () => {
        const { app } = appThrowing(undefined);

        const res = await request(app).post("/echo").send({ text: "much longer than ten bytes" });

        expect(res.status).toBe(413);
        expect(res.body.success).toBe(false);
    });

    it("logs unexpected errors and includes the message when exposeDetails is on", async () => {
        const err = new Error("database exploded");
        const { app, log } = appThrowing(err, true);

        const res = await request(app).get("/boom");

        expect(res.status).toBe(500);
        expect(res.body).toEqual({ success: false, error: "database exploded" });
        expect(log).toHaveBeenCalledWith(err);
    });

    it("hides unexpected error messages when exposeDetails is off", async () => {
        const { app } = appThrowing(new Error("secret internals"), false);

        const res = await request(app).get("/boom");

        expect(res.status).toBe(500);
        expect(res.body).toEqual({ success: false, error: "Internal server error" });
    });
});

describe("notFoundHandler", () => {
    it("returns 404 naming the method and path", async () => {
        const { app } = appThrowing(undefined);

        const res = await request(app).delete("/nope?x=1");

        expect(res.status).toBe(404);
        expect(res.body).toEqual({ success: false, error: "Route DELETE /nope not found" });
    });
});
