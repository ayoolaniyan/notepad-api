import { ErrorRequestHandler, RequestHandler } from "express";
import { AppError } from "../errors";
import { config } from "../config";

export const notFoundHandler: RequestHandler = (req, _res, next) => {
    next(new AppError(404, `Route ${req.method} ${req.path} not found`));
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof AppError) {
        res.status(err.statusCode).json({ success: false, error: err.message, errors: err.errors });
        return;
    }

    // Malformed JSON or oversized body from express.json()
    if (err?.type === "entity.parse.failed" || err?.type === "entity.too.large") {
        res.status(err.status).json({ success: false, error: err.message });
        return;
    }

    console.error(err);
    res.status(500).json({
        success: false,
        error: config.nodeEnv === "production" ? "Internal server error" : String(err?.message ?? err),
    });
};
