import cors from "cors";
import helmet from "helmet";
import { RequestHandler } from "express";
import { AppError } from "@notepad/shared";
import { config } from "../config";

const isProduction = config.nodeEnv === "production";

// Headers tuned for a JSON API: nothing may be rendered, framed or embedded
export const securityHeaders = helmet({
    contentSecurityPolicy: {
        useDefaults: false,
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    },
    crossOriginResourcePolicy: { policy: "same-site" },
    referrerPolicy: { policy: "no-referrer" },
    // HSTS only makes sense over HTTPS, which production terminates in front of the gateway
    strictTransportSecurity: isProduction ? { maxAge: 15_552_000, includeSubDomains: true } : false,
});

// Allowlisted origins only. Tokens travel in the Authorization header, not cookies,
// so credentialed CORS isn't needed. Unlisted origins simply get no CORS headers.
export const corsPolicy = cors({
    origin: config.corsOrigins,
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["Authorization", "Content-Type", "X-Request-Id"],
    exposedHeaders: ["X-Request-Id", "RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset", "RateLimit-Policy", "Retry-After"],
    credentials: false,
    maxAge: 600,
});

// Bodies are streamed to the services, which enforce their own (smaller) limits.
// This rejects obviously oversized requests before any upstream work happens.
export const bodySizeLimit: RequestHandler = (req, _res, next) => {
    const length = Number(req.headers["content-length"] ?? 0);
    next(length > config.maxBodyBytes ? new AppError(413, "Request body too large") : undefined);
};
