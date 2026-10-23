import express from "express";
import { createErrorHandler, createHealthHandler, notFoundHandler } from "@notepad/shared";
import { config } from "./config";
import { prisma } from "./database";
import { notesRouter } from "./routes/notes.routes";

export function createApp() {
    const app = express();

    app.disable("x-powered-by");
    // Notes can be long (content is capped at 100k characters by validation)
    app.use(express.json({ limit: "1mb" }));

    app.get(
        "/health",
        createHealthHandler({ service: "notes-service", checkDatabase: () => prisma.$queryRaw`SELECT 1` }),
    );

    app.use("/notes", notesRouter);

    app.use(notFoundHandler);
    app.use(createErrorHandler({ exposeDetails: config.nodeEnv !== "production" }));

    return app;
}
