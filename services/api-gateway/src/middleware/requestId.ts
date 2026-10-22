import { randomUUID } from "node:crypto";
import { RequestHandler } from "express";

const HEADER = "x-request-id";
// Accept a client-supplied id only if it's short and safe to log and forward
const VALID_ID = /^[A-Za-z0-9._-]{8,128}$/;

// Gives every request an id, forwards it to the upstream service and returns it to the client
export const requestId: RequestHandler = (req, res, next) => {
    const incoming = req.headers[HEADER];
    const id = typeof incoming === "string" && VALID_ID.test(incoming) ? incoming : randomUUID();

    req.headers[HEADER] = id;
    res.setHeader("X-Request-Id", id);
    next();
};
