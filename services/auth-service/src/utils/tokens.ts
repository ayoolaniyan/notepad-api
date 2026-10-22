import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { ACCESS_TOKEN_ALGORITHM, AccessTokenPayload } from "@notepad/shared";
import { config } from "../config";

// Verification lives in @notepad/shared so every service checks tokens the same way
export function signAccessToken(payload: AccessTokenPayload): string {
    return jwt.sign({ email: payload.email }, config.jwt.accessSecret, {
        algorithm: ACCESS_TOKEN_ALGORITHM,
        subject: payload.sub,
        issuer: config.jwt.issuer,
        expiresIn: config.jwt.accessTtlSeconds,
    });
}

// Refresh tokens are opaque random strings; only their SHA-256 is stored
export function generateRefreshToken(): string {
    return randomBytes(32).toString("base64url");
}

export function hashRefreshToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}
