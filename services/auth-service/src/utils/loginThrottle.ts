import { AppError } from "@notepad/shared";
import { config } from "../config";

// Per-account limit on failed logins, independent of client IP. The gateway's per-IP
// limit can't stop credential stuffing spread across many IPs; this can.
//
// Keyed by the normalised email whether or not the account exists, so a locked-out
// response never reveals which emails are registered.
//
// In memory: limits are per auth-service instance and reset on restart.

interface Window {
    failures: number;
    resetAt: number;
}

const windows = new Map<string, Window>();

// Drop expired windows so memory can't grow without bound
setInterval(() => {
    const now = Date.now();
    for (const [email, window] of windows) {
        if (window.resetAt <= now) windows.delete(email);
    }
}, 60_000).unref();

function activeWindow(email: string): Window | undefined {
    const window = windows.get(email);
    if (window && window.resetAt <= Date.now()) {
        windows.delete(email);
        return undefined;
    }
    return window;
}

// Throws 429 when this email has used up its failed attempts for the current window
export function assertLoginAllowed(email: string): void {
    const window = activeWindow(email);
    if (window && window.failures >= config.loginThrottle.maxFailures) {
        const retryAfterSeconds = Math.ceil((window.resetAt - Date.now()) / 1000);
        throw new AppError(429, "Too many failed login attempts. Try again later.", undefined, {
            "Retry-After": String(retryAfterSeconds),
        });
    }
}

export function recordLoginFailure(email: string): void {
    const window = activeWindow(email);
    if (window) {
        window.failures++;
    } else {
        windows.set(email, { failures: 1, resetAt: Date.now() + config.loginThrottle.windowMs });
    }
}

export function clearLoginFailures(email: string): void {
    windows.delete(email);
}
