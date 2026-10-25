// Runs the cleanup once at startup and then every intervalMs. Failures are logged and
// retried on the next run, never thrown. Safe with several instances: deleting
// expired rows is idempotent. Returns a function that stops the schedule.
export function scheduleTokenCleanup(
    cleanup: () => Promise<number>,
    intervalMs: number,
    log: Pick<Console, "log" | "error"> = console,
): () => void {
    const run = () => {
        void cleanup().then(
            (deleted) => {
                if (deleted > 0) log.log(`Deleted ${deleted} expired refresh token(s)`);
            },
            (err: unknown) => log.error("Refresh token cleanup failed:", err),
        );
    };

    run();
    const timer = setInterval(run, intervalMs);
    // Don't keep the process alive just for cleanup
    timer.unref();
    return () => clearInterval(timer);
}
