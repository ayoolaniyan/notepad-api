import { RequestHandler } from "express";
import { AppError } from "../errors";
import { verifyAccessToken } from "../utils/tokens";

export const requireAuth: RequestHandler = (req, _res, next) => {
    const [scheme, token] = req.headers.authorization?.split(" ") ?? [];

    if (scheme !== "Bearer" || !token) {
        return next(new AppError(401, "Missing or malformed Authorization header"));
    }

    try {
        const payload = verifyAccessToken(token);
        req.user = { id: payload.sub, email: payload.email };
        next();
    } catch {
        next(new AppError(401, "Invalid or expired access token"));
    }
};
