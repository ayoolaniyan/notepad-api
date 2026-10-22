import { RequestHandler } from "express";
import { ObjectSchema } from "joi";
import { AppError } from "./errors";

function validate(schema: ObjectSchema, input: unknown, fallbackField: string) {
    const { error, value } = schema.validate(input ?? {}, { abortEarly: false, stripUnknown: true });
    if (!error) return value;

    const errors: Record<string, string[]> = {};
    for (const detail of error.details) {
        const field = detail.path.join(".") || fallbackField;
        (errors[field] ??= []).push(detail.message);
    }
    throw new AppError(400, "Validation failed", errors);
}

// Validates req.body against a Joi schema and replaces it with the sanitized value
export function validateBody(schema: ObjectSchema): RequestHandler {
    return (req, _res, next) => {
        req.body = validate(schema, req.body, "body");
        next();
    };
}

// Validates req.query and replaces it with the sanitized, type-converted value
export function validateQuery(schema: ObjectSchema): RequestHandler {
    return (req, _res, next) => {
        const value = validate(schema, req.query, "query");
        // Express 5 exposes req.query as a getter, so it can't be assigned directly
        Object.defineProperty(req, "query", { value, writable: true, configurable: true, enumerable: true });
        next();
    };
}
