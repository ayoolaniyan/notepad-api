import { describe, expect, it } from "@jest/globals";
import { fail, ok } from "./responses";

describe("response envelope", () => {
    it("ok wraps data and an optional message", () => {
        expect(ok({ id: 1 }, "Created")).toEqual({ success: true, data: { id: 1 }, message: "Created" });
    });

    it("fail carries the error and optional field errors", () => {
        expect(fail("Validation failed", { title: ["Required"] })).toEqual({
            success: false,
            error: "Validation failed",
            errors: { title: ["Required"] },
        });
    });
});
