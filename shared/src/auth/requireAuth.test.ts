import { describe, expect, it } from "@jest/globals";
import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import "./express";
import { createErrorHandler } from "../http/errorHandler";
import { verifyAccessToken } from "./jwt";
import { createRequireAuth } from "./requireAuth";

const options = { secret: "a-test-secret-that-is-at-least-32-chars", issuer: "test-issuer" };

function sign(claims: object, overrides: jwt.SignOptions = {}, secret = options.secret) {
    return jwt.sign(claims, secret, {
        algorithm: "HS256",
        subject: "user-1",
        issuer: options.issuer,
        expiresIn: 60,
        ...overrides,
    });
}

const app = express();
app.get("/me", createRequireAuth(options), (req, res) => {
    res.json(req.user);
});
app.use(createErrorHandler({ exposeDetails: true }));

describe("verifyAccessToken", () => {
    it("returns the subject and email of a valid token", () => {
        expect(verifyAccessToken(sign({ email: "a@example.com" }), options)).toEqual({
            sub: "user-1",
            email: "a@example.com",
        });
    });

    it.each([
        ["an expired token", () => sign({ email: "a@example.com" }, { expiresIn: -10 })],
        ["the wrong issuer", () => sign({ email: "a@example.com" }, { issuer: "someone-else" })],
        ["the wrong secret", () => sign({ email: "a@example.com" }, {}, "another-secret-that-is-32-chars-long")],
        ["a different algorithm", () => sign({ email: "a@example.com" }, { algorithm: "HS512" })],
        [
            "an unsigned token",
            () => jwt.sign({ email: "a@example.com", sub: "user-1", iss: options.issuer }, "", { algorithm: "none" }),
        ],
        ["a token without an email", () => sign({})],
    ])("rejects %s", (_name, token) => {
        expect(() => verifyAccessToken(token(), options)).toThrow();
    });
});

describe("createRequireAuth", () => {
    it("attaches the caller to req.user", async () => {
        const res = await request(app)
            .get("/me")
            .set("Authorization", `Bearer ${sign({ email: "a@example.com" })}`);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ id: "user-1", email: "a@example.com" });
    });

    it.each([
        ["no header", undefined],
        ["a non-Bearer scheme", `Basic ${Buffer.from("a:b").toString("base64")}`],
        ["an empty token", "Bearer "],
    ])("returns 401 with %s", async (_name, header) => {
        const req = request(app).get("/me");
        if (header !== undefined) req.set("Authorization", header);

        const res = await req;

        expect(res.status).toBe(401);
        expect(res.body.error).toBe("Missing or malformed Authorization header");
    });

    it("returns 401 for an invalid token", async () => {
        const res = await request(app).get("/me").set("Authorization", "Bearer not-a-jwt");

        expect(res.status).toBe(401);
        expect(res.body.error).toBe("Invalid or expired access token");
    });
});
