import Joi from "joi";

export const TITLE_MAX = 200;
export const CONTENT_MAX = 100_000;

const title = Joi.string().trim().min(1).max(TITLE_MAX).messages({
    "string.empty": "Title cannot be empty",
    "string.max": `Title must be at most ${TITLE_MAX} characters`,
});
const content = Joi.string().allow("").max(CONTENT_MAX).messages({
    "string.max": `Content must be at most ${CONTENT_MAX} characters`,
});
const isPinned = Joi.boolean().strict();

export const createNoteSchema = Joi.object({
    title: title.required().messages({ "any.required": "Title is required" }),
    content: content.default(""),
    isPinned: isPinned.default(false),
});

export const updateNoteSchema = Joi.object({ title, content, isPinned })
    .min(1)
    .messages({ "object.min": "Provide at least one of: title, content, isPinned" });

export const listNotesQuerySchema = Joi.object({
    limit: Joi.number().integer().min(1).max(100).default(20),
    cursor: Joi.string().max(500),
    q: Joi.string().trim().min(1).max(200),
    pinned: Joi.boolean(),
});

export const noteIdSchema = Joi.string().guid({ version: ["uuidv4"] }).required();
