import { ErrorRequestHandler, RequestHandler } from "express";
import { AppError } from "./errors";
import { fail } from "./responses";

export interface ErrorHandlerOptions {
    // Include unexpected error messages in 500 responses (disable in production)
    exposeDetails: boolean;
    log?: (err: unknown) => void;
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
    next(new AppError(404, `Route ${req.method} ${req.path} not found`));
};

export function createErrorHandler({ exposeDetails, log = console.error }: ErrorHandlerOptions): ErrorRequestHandler {
    return (err, _req, res, _next) => {
        if (err instanceof AppError) {
            if (err.headers) res.set(err.headers);
            res.status(err.statusCode).json(fail(err.message, err.errors));
            return;
        }

        // Malformed JSON or oversized body from express.json()
        if (err?.type === "entity.parse.failed" || err?.type === "entity.too.large") {
            res.status(err.status).json(fail(err.message));
            return;
        }

        log(err);
        res.status(500).json(fail(exposeDetails ? String(err?.message ?? err) : "Internal server error"));
    };
}
