import { createRequireAuth } from "@notepad/shared";
import { config } from "./config";

export const requireAuth = createRequireAuth({ secret: config.jwt.accessSecret, issuer: config.jwt.issuer });
