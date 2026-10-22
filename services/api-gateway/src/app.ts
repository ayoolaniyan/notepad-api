import express from "express";
import { createErrorHandler, notFoundHandler } from "@notepad/shared";
import { config } from "./config";
import { createGatewayHealthHandler } from "./health";
import { createServiceProxy } from "./proxy";
import { accessLog } from "./middleware/logger";
import { requestId } from "./middleware/requestId";
import { bodySizeLimit, corsPolicy, securityHeaders } from "./middleware/security";
import { globalLimiter, loginLimiter, refreshLimiter, registerLimiter } from "./middleware/rateLimits";

export function createApp() {
    const app = express();

    app.disable("x-powered-by");
    // Decides which X-Forwarded-For entry is the real client IP (used by the rate limiters)
    app.set("trust proxy", config.trustProxy);

    app.use(requestId);
    app.use(accessLog);
    app.use(securityHeaders);
    // Before the limiters, so preflights aren't counted and 429s still carry CORS headers
    app.use(corsPolicy);

    // Health is checked constantly by load balancers, so it's exempt from rate limiting
    app.get("/health", createGatewayHealthHandler());

    app.use(globalLimiter);
    app.use(bodySizeLimit);

    app.post("/api/v1/auth/login", loginLimiter);
    app.post("/api/v1/auth/register", registerLimiter);
    app.post("/api/v1/auth/refresh", refreshLimiter);

    app.use(
        "/api/v1/auth",
        createServiceProxy({
            name: "auth",
            target: config.upstreams.auth,
            upstreamPrefix: "/auth",
            // Responses carry tokens; keep them out of browser and proxy caches
            responseHeaders: { "cache-control": "no-store" },
        }),
    );
    app.use(
        "/api/v1/notes",
        createServiceProxy({ name: "notes", target: config.upstreams.notes, upstreamPrefix: "/notes" }),
    );

    app.use(notFoundHandler);
    app.use(createErrorHandler({ exposeDetails: config.nodeEnv !== "production" }));

    return app;
}
