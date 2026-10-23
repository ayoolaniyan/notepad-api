import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "@jest/globals";
import jwt from "jsonwebtoken";
import request from "supertest";
import { ACCESS_TOKEN_ALGORITHM } from "@notepad/shared";
import { createApp } from "../src/app";
import { config } from "../src/config";
import { prisma } from "../src/database";

const app = createApp();

interface Note {
    id: string;
    title: string;
    content: string;
    isPinned: boolean;
    createdAt: string;
    updatedAt: string;
}

// Signs a token the way auth-service does. Every test acts as a new random user, and notes
// are scoped by user, so tests never see each other's data.
function newUser() {
    const id = randomUUID();
    const token = jwt.sign({ email: `${id}@example.com` }, config.jwt.accessSecret, {
        algorithm: ACCESS_TOKEN_ALGORITHM,
        subject: id,
        issuer: config.jwt.issuer,
        expiresIn: 60,
    });
    const auth = { Authorization: `Bearer ${token}` };

    return {
        id,
        get: (path: string) => request(app).get(path).set(auth),
        post: (path: string, body?: object) => request(app).post(path).set(auth).send(body),
        patch: (path: string, body?: object) => request(app).patch(path).set(auth).send(body),
        delete: (path: string) => request(app).delete(path).set(auth),
        async create(body: Partial<Note> = {}): Promise<Note> {
            const res = await this.post("/notes", { title: "Untitled", ...body });
            expect(res.status).toBe(201);
            return res.body.data.note as Note;
        },
    };
}

afterAll(async () => {
    await prisma.$disconnect();
});

describe("authentication", () => {
    it("rejects requests without a token", async () => {
        const res = await request(app).get("/notes");

        expect(res.status).toBe(401);
    });

    it("rejects a token signed with another secret", async () => {
        const token = jwt.sign({ email: "a@example.com" }, "some-other-secret-that-is-32-chars", {
            subject: randomUUID(),
            issuer: config.jwt.issuer,
        });

        const res = await request(app).get("/notes").set("Authorization", `Bearer ${token}`);

        expect(res.status).toBe(401);
    });
});

describe("GET /health", () => {
    it("reports the database as reachable", async () => {
        const res = await request(app).get("/health");

        expect(res.status).toBe(200);
        expect(res.body.data.database).toBe(true);
    });
});

describe("POST /notes", () => {
    it("creates a note with defaults and never returns userId", async () => {
        const user = newUser();

        const res = await user.post("/notes", { title: "  Groceries  " });

        expect(res.status).toBe(201);
        expect(res.body.data.note).toEqual({
            id: expect.any(String),
            title: "Groceries",
            content: "",
            isPinned: false,
            createdAt: expect.any(String),
            updatedAt: expect.any(String),
        });
        const stored = await prisma.note.findUniqueOrThrow({ where: { id: res.body.data.note.id } });
        expect(stored.userId).toBe(user.id);
    });

    it("ignores a userId in the body", async () => {
        const user = newUser();

        const res = await user.post("/notes", { title: "Mine", userId: randomUUID() });

        const stored = await prisma.note.findUniqueOrThrow({ where: { id: res.body.data.note.id } });
        expect(stored.userId).toBe(user.id);
    });

    it("returns 400 for invalid input", async () => {
        const res = await newUser().post("/notes", { title: "", isPinned: "yes" });

        expect(res.status).toBe(400);
        expect(Object.keys(res.body.errors).sort()).toEqual(["isPinned", "title"]);
    });
});

describe("GET /notes/:id", () => {
    it("returns the caller's note", async () => {
        const user = newUser();
        const note = await user.create({ title: "Hello", content: "World" });

        const res = await user.get(`/notes/${note.id}`);

        expect(res.status).toBe(200);
        expect(res.body.data.note).toEqual(note);
    });

    it("returns 404 for another user's note", async () => {
        const note = await newUser().create();

        const res = await newUser().get(`/notes/${note.id}`);

        expect(res.status).toBe(404);
        expect(res.body.error).toBe("Note not found");
    });

    it("returns 404 for a malformed id", async () => {
        expect((await newUser().get("/notes/not-a-uuid")).status).toBe(404);
    });
});

describe("PATCH /notes/:id", () => {
    it("updates only the given fields", async () => {
        const user = newUser();
        const note = await user.create({ title: "Draft", content: "Body" });

        const res = await user.patch(`/notes/${note.id}`, { isPinned: true });

        expect(res.status).toBe(200);
        expect(res.body.data.note).toMatchObject({ title: "Draft", content: "Body", isPinned: true });
        expect(Date.parse(res.body.data.note.updatedAt)).toBeGreaterThanOrEqual(Date.parse(note.updatedAt));
    });

    it("returns 400 for an empty update", async () => {
        const user = newUser();
        const note = await user.create();

        expect((await user.patch(`/notes/${note.id}`, {})).status).toBe(400);
    });

    it("can't modify another user's note", async () => {
        const note = await newUser().create({ title: "Original" });

        const res = await newUser().patch(`/notes/${note.id}`, { title: "Hijacked" });

        expect(res.status).toBe(404);
        expect((await prisma.note.findUniqueOrThrow({ where: { id: note.id } })).title).toBe("Original");
    });
});

describe("DELETE /notes/:id", () => {
    it("deletes the note, then returns 404", async () => {
        const user = newUser();
        const note = await user.create();

        expect((await user.delete(`/notes/${note.id}`)).status).toBe(200);
        expect((await user.get(`/notes/${note.id}`)).status).toBe(404);
        expect((await user.delete(`/notes/${note.id}`)).status).toBe(404);
    });

    it("can't delete another user's note", async () => {
        const note = await newUser().create();

        expect((await newUser().delete(`/notes/${note.id}`)).status).toBe(404);
        expect(await prisma.note.count({ where: { id: note.id } })).toBe(1);
    });
});

describe("GET /notes", () => {
    it("lists only the caller's notes, pinned first, then most recently updated", async () => {
        const user = newUser();
        const older = await user.create({ title: "older" });
        const pinned = await user.create({ title: "pinned", isPinned: true });
        const newer = await user.create({ title: "newer" });
        await newUser().create({ title: "someone else's" });
        // Explicit timestamps: notes created within the same millisecond would otherwise tie
        const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
        await prisma.note.update({ where: { id: older.id }, data: { updatedAt: minutesAgo(3) } });
        await prisma.note.update({ where: { id: pinned.id }, data: { updatedAt: minutesAgo(2) } });
        await prisma.note.update({ where: { id: newer.id }, data: { updatedAt: minutesAgo(1) } });

        const res = await user.get("/notes");

        expect(res.status).toBe(200);
        expect(res.body.data.notes.map((n: Note) => n.id)).toEqual([pinned.id, newer.id, older.id]);
        expect(res.body.data.nextCursor).toBeNull();
    });

    it("pages through every note exactly once with the cursor", async () => {
        const user = newUser();
        // Created in parallel so several share an updatedAt, exercising the id tiebreak
        await Promise.all(Array.from({ length: 7 }, (_, i) => user.create({ title: `n${i}`, isPinned: i % 3 === 0 })));
        const all: Note[] = (await user.get("/notes?limit=100")).body.data.notes;

        const paged: Note[] = [];
        let cursor: string | null = null;
        do {
            const res = await user.get(`/notes?limit=3${cursor ? `&cursor=${cursor}` : ""}`);
            expect(res.status).toBe(200);
            paged.push(...res.body.data.notes);
            cursor = res.body.data.nextCursor;
        } while (cursor);

        expect(all).toHaveLength(7);
        expect(paged.map((n) => n.id)).toEqual(all.map((n) => n.id));
    });

    it("searches title and content case-insensitively", async () => {
        const user = newUser();
        const inTitle = await user.create({ title: "Buy MILK" });
        const inContent = await user.create({ title: "List", content: "eggs and milk" });
        await user.create({ title: "Unrelated" });

        const res = await user.get("/notes?q=milk");

        expect(res.body.data.notes.map((n: Note) => n.id).sort()).toEqual([inTitle.id, inContent.id].sort());
    });

    it("filters by pinned", async () => {
        const user = newUser();
        const pinned = await user.create({ isPinned: true });
        await user.create();

        const res = await user.get("/notes?pinned=true");

        expect(res.body.data.notes.map((n: Note) => n.id)).toEqual([pinned.id]);
    });

    it.each(["limit=0", "limit=101", "cursor=not-a-cursor"])("returns 400 for %s", async (query) => {
        expect((await newUser().get(`/notes?${query}`)).status).toBe(400);
    });
});
