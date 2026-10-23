import { describe, expect, it } from "@jest/globals";
import express from "express";
import Joi from "joi";
import request from "supertest";
import { createErrorHandler } from "./errorHandler";
import { validateBody, validateQuery } from "./validate";

const bodySchema = Joi.object({
    name: Joi.string().trim().required(),
    age: Joi.number().integer().min(0),
});

const querySchema = Joi.object({
    limit: Joi.number().integer().max(100).default(20),
    pinned: Joi.boolean(),
});

const app = express();
app.use(express.json());
app.post("/body", validateBody(bodySchema), (req, res) => {
    res.json(req.body);
});
app.get("/query", validateQuery(querySchema), (req, res) => {
    res.json(req.query);
});
app.use(createErrorHandler({ exposeDetails: true }));

describe("validateBody", () => {
    it("replaces the body with the sanitized value and strips unknown fields", async () => {
        const res = await request(app).post("/body").send({ name: "  Ada  ", age: 36, role: "admin" });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ name: "Ada", age: 36 });
    });

    it("returns 400 with every error grouped by field", async () => {
        const res = await request(app).post("/body").send({ age: -1 });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Validation failed");
        expect(Object.keys(res.body.errors).sort()).toEqual(["age", "name"]);
    });

    it("treats a missing body as empty", async () => {
        const res = await request(app).post("/body");

        expect(res.status).toBe(400);
        expect(res.body.errors).toHaveProperty("name");
    });

    it("reports object-level errors under 'body'", async () => {
        const res = await request(app).post("/body").set("Content-Type", "application/json").send("[]");

        expect(res.status).toBe(400);
        expect(res.body.errors).toHaveProperty("body");
    });
});

describe("validateQuery", () => {
    it("converts types and applies defaults", async () => {
        const res = await request(app).get("/query?pinned=true");

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ limit: 20, pinned: true });
    });

    it("returns 400 for invalid query values", async () => {
        const res = await request(app).get("/query?limit=500");

        expect(res.status).toBe(400);
        expect(res.body.errors).toHaveProperty("limit");
    });
});
