import jwt from "jsonwebtoken";
import { AccessTokenPayload } from "../types";

export interface JwtVerifyOptions {
    secret: string;
    issuer: string;
}

// The only algorithm access tokens may be signed or verified with
export const ACCESS_TOKEN_ALGORITHM = "HS256" as const;

// Throws if the token is invalid, expired, or signed with a different algorithm/issuer
export function verifyAccessToken(token: string, { secret, issuer }: JwtVerifyOptions): AccessTokenPayload {
    const decoded = jwt.verify(token, secret, {
        algorithms: [ACCESS_TOKEN_ALGORITHM],
        issuer,
    });
    if (typeof decoded === "string" || !decoded.sub || typeof decoded.email !== "string") {
        throw new Error("Malformed access token payload");
    }
    return { sub: decoded.sub, email: decoded.email };
}
