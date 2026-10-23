import express from "express";
import { createErrorHandler, createHealthHandler, notFoundHandler } from "@notepad/shared";
import { config } from "./config";
import { prisma } from "./database";
import { authRouter } from "./routes/auth.routes";

export function createApp() {
    const app = express();

    app.disable("x-powered-by");
    app.use(express.json({ limit: "100kb" }));

    app.get(
        "/health",
        createHealthHandler({ service: "auth-service", checkDatabase: () => prisma.$queryRaw`SELECT 1` }),
    );

    app.use("/auth", authRouter);

    app.use(notFoundHandler);
    app.use(createErrorHandler({ exposeDetails: config.nodeEnv !== "production" }));

    return app;
}
