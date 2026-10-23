import { rateLimit, Options } from "express-rate-limit";
import { fail } from "@notepad/shared";
import { config } from "../config";

// Counters are in memory, so limits are per gateway instance.
// Pass a shared store (e.g. rate-limit-redis) here once there are several instances.
function createLimiter(
    name: string,
    { max, windowMs }: { max: number; windowMs: number },
    extra: Partial<Options> = {},
) {
    return rateLimit({
        windowMs,
        limit: max,
        identifier: name,
        standardHeaders: "draft-6",
        legacyHeaders: false,
        handler: (_req, res, _next, options) => {
            res.status(options.statusCode).json(fail("Too many requests, please try again later"));
        },
        ...extra,
    });
}

export const globalLimiter = createLimiter("global", config.rateLimits.global);

// Only failed logins count, so a user who signs in successfully is never locked out
export const loginLimiter = createLimiter("login", config.rateLimits.login, { skipSuccessfulRequests: true });

export const registerLimiter = createLimiter("register", config.rateLimits.register);

export const refreshLimiter = createLimiter("refresh", config.rateLimits.refresh);
