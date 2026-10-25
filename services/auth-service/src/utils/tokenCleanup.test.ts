import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { scheduleTokenCleanup } from "./tokenCleanup";

const INTERVAL = 60_000;

describe("token cleanup schedule", () => {
    let log: { log: jest.Mock; error: jest.Mock };
    let stop: (() => void) | undefined;

    beforeEach(() => {
        jest.useFakeTimers();
        log = { log: jest.fn(), error: jest.fn() };
        stop = undefined;
    });

    afterEach(() => {
        stop?.();
        jest.useRealTimers();
    });

    it("runs at startup and then on every interval", async () => {
        const cleanup = jest.fn(() => Promise.resolve(0));

        stop = scheduleTokenCleanup(cleanup, INTERVAL, log);
        expect(cleanup).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(INTERVAL * 2);
        expect(cleanup).toHaveBeenCalledTimes(3);
    });

    it("logs how many tokens were deleted, and stays quiet when none were", async () => {
        const cleanup = jest.fn<() => Promise<number>>().mockResolvedValueOnce(0).mockResolvedValueOnce(4);

        stop = scheduleTokenCleanup(cleanup, INTERVAL, log);
        await jest.advanceTimersByTimeAsync(INTERVAL);

        expect(log.log).toHaveBeenCalledTimes(1);
        expect(log.log).toHaveBeenCalledWith("Deleted 4 expired refresh token(s)");
    });

    it("logs a failure and keeps the schedule running", async () => {
        const cleanup = jest
            .fn<() => Promise<number>>()
            .mockRejectedValueOnce(new Error("db down"))
            .mockResolvedValue(0);

        stop = scheduleTokenCleanup(cleanup, INTERVAL, log);
        await jest.advanceTimersByTimeAsync(INTERVAL);

        expect(log.error).toHaveBeenCalledWith("Refresh token cleanup failed:", expect.any(Error));
        expect(cleanup).toHaveBeenCalledTimes(2);
    });

    it("stops when the returned function is called", async () => {
        const cleanup = jest.fn(() => Promise.resolve(0));

        scheduleTokenCleanup(cleanup, INTERVAL, log)();
        await jest.advanceTimersByTimeAsync(INTERVAL * 3);

        expect(cleanup).toHaveBeenCalledTimes(1);
    });
});
