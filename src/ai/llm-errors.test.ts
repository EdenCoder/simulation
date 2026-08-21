import { describe, expect, it } from "vitest";

import { isTimeoutError } from "./llm-errors";

describe("isTimeoutError", () => {
  it("recognizes AbortSignal.timeout aborts", () => {
    expect(isTimeoutError({ name: "TimeoutError" })).toBe(true);
    expect(isTimeoutError({ name: "AbortError" })).toBe(true);
    expect(isTimeoutError({ message: "The operation was aborted" })).toBe(true);
  });

  it("recognizes Bottleneck job expiration", () => {
    expect(
      isTimeoutError({
        name: "BottleneckError",
        message: "This job timed out after 150000 ms.",
      }),
    ).toBe(true);
  });

  it("does not match ordinary API errors", () => {
    expect(isTimeoutError({ status: 429, message: "Rate limited" })).toBe(
      false,
    );
    expect(isTimeoutError({ message: "400 invalid tool call" })).toBe(false);
    expect(isTimeoutError(undefined)).toBe(false);
  });
});
