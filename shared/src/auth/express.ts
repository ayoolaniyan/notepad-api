import { AuthUser } from "../types";

// Augments Express so any service importing @notepad/shared gets a typed req.user
declare global {
    namespace Express {
        interface Request {
            user?: AuthUser;
        }
    }
}

export {};
