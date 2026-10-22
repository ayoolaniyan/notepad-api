import { RequestHandler } from "express";
import { ObjectSchema } from "joi";
import { AppError } from "./errors";

// Validates req.body against a Joi schema and replaces it with the sanitized value
export function validateBody(schema: ObjectSchema): RequestHandler {
    return (req, _res, next) => {
        const { error, value } = schema.validate(req.body ?? {}, { abortEarly: false, stripUnknown: true });

        if (error) {
            const errors: Record<string, string[]> = {};
            for (const detail of error.details) {
                const field = detail.path.join(".") || "body";
                (errors[field] ??= []).push(detail.message);
            }
            return next(new AppError(400, "Validation failed", errors));
        }

        req.body = value;
        next();
    };
}
