import express from "express";
import { createErrorHandler, notFoundHandler } from "@notepad/shared";
import { config } from "./config";
import { isDatabaseHealthy } from "./database";
import { authRouter } from "./routes/auth.routes";

export function createApp() {
    const app = express();

    app.disable("x-powered-by");
    app.use(express.json({ limit: "100kb" }));

    app.get("/health", async (_req, res) => {
        const database = await isDatabaseHealthy();
        res.status(database ? 200 : 503).json({
            success: database,
            data: { service: "auth-service", status: database ? "ok" : "degraded", database },
        });
    });

    app.use("/auth", authRouter);

    app.use(notFoundHandler);
    app.use(createErrorHandler({ exposeDetails: config.nodeEnv !== "production" }));

    return app;
}
