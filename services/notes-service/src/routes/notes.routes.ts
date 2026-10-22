import { Router } from "express";
import { AppError, ok, validateBody, validateQuery } from "@notepad/shared";
import * as notesService from "../services/notes.service";
import { requireAuth } from "../middleware";
import { createNoteSchema, listNotesQuerySchema, noteIdSchema, updateNoteSchema } from "../validation";

export const notesRouter = Router();

notesRouter.use(requireAuth);

// A malformed id can't match any note, so it gets the same 404 as a missing or foreign one
notesRouter.param("id", (_req, _res, next, id) => {
    next(noteIdSchema.validate(id).error ? new AppError(404, "Note not found") : undefined);
});

notesRouter.get("/", validateQuery(listNotesQuerySchema), async (req, res) => {
    const result = await notesService.listNotes(req.user!.id, req.query as unknown as notesService.ListNotesOptions);
    res.json(ok(result));
});

notesRouter.post("/", validateBody(createNoteSchema), async (req, res) => {
    const note = await notesService.createNote(req.user!.id, req.body);
    res.status(201).json(ok({ note }, "Note created"));
});

notesRouter.get<{ id: string }>("/:id", async (req, res) => {
    const note = await notesService.getNote(req.user!.id, req.params.id);
    res.json(ok({ note }));
});

notesRouter.patch<{ id: string }>("/:id", validateBody(updateNoteSchema), async (req, res) => {
    const note = await notesService.updateNote(req.user!.id, req.params.id, req.body);
    res.json(ok({ note }, "Note updated"));
});

notesRouter.delete<{ id: string }>("/:id", async (req, res) => {
    await notesService.deleteNote(req.user!.id, req.params.id);
    res.json(ok(undefined, "Note deleted"));
});
