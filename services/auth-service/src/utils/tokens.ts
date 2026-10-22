import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { config } from "../config";

export interface AccessTokenPayload {
    sub: string;
    email: string;
}

export function signAccessToken(payload: AccessTokenPayload): string {
    return jwt.sign({ email: payload.email }, config.jwt.accessSecret, {
        algorithm: "HS256",
        subject: payload.sub,
        issuer: config.jwt.issuer,
        expiresIn: config.jwt.accessTtlSeconds,
    });
}

// Throws if the token is invalid, expired, or signed with a different algorithm/issuer
export function verifyAccessToken(token: string): AccessTokenPayload {
    const decoded = jwt.verify(token, config.jwt.accessSecret, {
        algorithms: ["HS256"],
        issuer: config.jwt.issuer,
    });
    if (typeof decoded === "string" || !decoded.sub || typeof decoded.email !== "string") {
        throw new Error("Malformed access token payload");
    }
    return { sub: decoded.sub, email: decoded.email };
}

// Refresh tokens are opaque random strings; only their SHA-256 is stored
export function generateRefreshToken(): string {
    return randomBytes(32).toString("base64url");
}

export function hashRefreshToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}
