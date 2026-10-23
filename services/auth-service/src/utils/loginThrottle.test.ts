import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { AppError } from "@notepad/shared";
import { config } from "../config";
import { assertLoginAllowed, clearLoginFailures, recordLoginFailure } from "./loginThrottle";

const { maxFailures, windowMs } = config.loginThrottle;

function fail(email: string, times: number) {
    for (let i = 0; i < times; i++) recordLoginFailure(email);
}

function lockoutError(email: string): AppError | undefined {
    try {
        assertLoginAllowed(email);
        return undefined;
    } catch (err) {
        return err as AppError;
    }
}

describe("login throttle", () => {
    let email: string;
    let n = 0;

    beforeEach(() => {
        jest.useFakeTimers();
        email = `user${++n}@example.com`;
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it("allows logins until the failure limit is reached", () => {
        fail(email, maxFailures - 1);

        expect(lockoutError(email)).toBeUndefined();
    });

    it("locks the account with 429 and Retry-After once the limit is reached", () => {
        fail(email, maxFailures);

        const err = lockoutError(email);

        expect(err).toBeInstanceOf(AppError);
        expect(err?.statusCode).toBe(429);
        expect(err?.headers?.["Retry-After"]).toBe(String(windowMs / 1000));
    });

    it("counts failures per email", () => {
        fail(email, maxFailures);

        expect(lockoutError("someone-else@example.com")).toBeUndefined();
    });

    it("unlocks when the window expires", () => {
        fail(email, maxFailures);

        jest.advanceTimersByTime(windowMs);

        expect(lockoutError(email)).toBeUndefined();
    });

    it("doesn't extend the window on later failures", () => {
        fail(email, 1);
        jest.advanceTimersByTime(windowMs - 1000);
        fail(email, maxFailures - 1);

        jest.advanceTimersByTime(1000);

        expect(lockoutError(email)).toBeUndefined();
    });

    it("clearLoginFailures resets the count", () => {
        fail(email, maxFailures);

        clearLoginFailures(email);

        expect(lockoutError(email)).toBeUndefined();
    });
});
