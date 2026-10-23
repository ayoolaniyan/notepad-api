import { describe, expect, it } from "@jest/globals";
import {
    CONTENT_MAX,
    TITLE_MAX,
    createNoteSchema,
    listNotesQuerySchema,
    noteIdSchema,
    updateNoteSchema,
} from "./validation";

describe("createNoteSchema", () => {
    it("trims the title and fills defaults", () => {
        const { value, error } = createNoteSchema.validate({ title: "  Groceries  " });

        expect(error).toBeUndefined();
        expect(value).toEqual({ title: "Groceries", content: "", isPinned: false });
    });

    it.each([
        ["a missing title", {}],
        ["a blank title", { title: "   " }],
        ["a title over the limit", { title: "x".repeat(TITLE_MAX + 1) }],
        ["content over the limit", { title: "t", content: "x".repeat(CONTENT_MAX + 1) }],
        ["isPinned as a string", { title: "t", isPinned: "true" }],
    ])("rejects %s", (_name, body) => {
        expect(createNoteSchema.validate(body).error).toBeDefined();
    });
});

describe("updateNoteSchema", () => {
    it("requires at least one field", () => {
        expect(updateNoteSchema.validate({}).error?.message).toBe("Provide at least one of: title, content, isPinned");
    });

    it("allows clearing the content", () => {
        expect(updateNoteSchema.validate({ content: "" }).error).toBeUndefined();
    });
});

describe("listNotesQuerySchema", () => {
    it("converts query strings and defaults the limit", () => {
        expect(listNotesQuerySchema.validate({ pinned: "false" }).value).toEqual({ limit: 20, pinned: false });
    });

    it.each([{ limit: "0" }, { limit: "101" }, { limit: "1.5" }, { q: "  " }])("rejects %p", (query) => {
        expect(listNotesQuerySchema.validate(query).error).toBeDefined();
    });
});

describe("noteIdSchema", () => {
    it("accepts a v4 UUID and rejects anything else", () => {
        expect(noteIdSchema.validate("6f1c2a52-5a4c-4a8e-9d1f-0f6a2c3b4d5e").error).toBeUndefined();
        expect(noteIdSchema.validate("123").error).toBeDefined();
    });
});
