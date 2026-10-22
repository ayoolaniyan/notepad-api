import { RequestHandler } from "express";
import { AppError } from "../http/errors";
import { JwtVerifyOptions, verifyAccessToken } from "./jwt";

// Returns middleware that rejects requests without a valid Bearer access token
// and attaches the caller to req.user
export function createRequireAuth(options: JwtVerifyOptions): RequestHandler {
    return (req, _res, next) => {
        const [scheme, token] = req.headers.authorization?.split(" ") ?? [];

        if (scheme !== "Bearer" || !token) {
            return next(new AppError(401, "Missing or malformed Authorization header"));
        }

        try {
            const payload = verifyAccessToken(token, options);
            req.user = { id: payload.sub, email: payload.email };
            next();
        } catch {
            next(new AppError(401, "Invalid or expired access token"));
        }
    };
}
