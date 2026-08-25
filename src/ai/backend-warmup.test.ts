import { describe, expect, it } from "vitest";

import { createBackendWarmupGate } from "./backend-warmup";

function flush(): Promise<void> {
  return Promise.resolve();
}

describe("backend warmup gate", () => {
  it("lets the first caller through immediately", async () => {
    const gate = createBackendWarmupGate();
    await gate.acquire("a1");
    expect(gate.isWarmedUp()).toBe(false);
  });

  it("holds later callers until the first success", async () => {
    const gate = createBackendWarmupGate();
    await gate.acquire("a1");

    let second = false;
    let third = false;
    const p2 = gate.acquire("a2").then(() => {
      second = true;
    });
    const p3 = gate.acquire("a3").then(() => {
      third = true;
    });
    await flush();
    expect(second).toBe(false);
    expect(third).toBe(false);

    gate.markSuccess();
    await Promise.all([p2, p3]);
    expect(second).toBe(true);
    expect(third).toBe(true);
    expect(gate.isWarmedUp()).toBe(true);
  });

  it("hands the exclusive slot to the next waiter on failure", async () => {
    const gate = createBackendWarmupGate();
    await gate.acquire("a1");

    let second = false;
    const p2 = gate.acquire("a2").then(() => {
      second = true;
    });
    await flush();
    expect(second).toBe(false);

    gate.releaseWithoutSuccess();
    await p2;
    expect(second).toBe(true);
    expect(gate.isWarmedUp()).toBe(false);

    let third = false;
    const p3 = gate.acquire("a3").then(() => {
      third = true;
    });
    await flush();
    expect(third).toBe(false);

    gate.releaseWithoutSuccess();
    await p3;
    expect(third).toBe(true);
    expect(gate.isWarmedUp()).toBe(false);
  });

  it("is a no-op after the first success", async () => {
    const gate = createBackendWarmupGate();
    await gate.acquire("a1");
    gate.markSuccess();

    await gate.acquire("a2");
    await gate.acquire("a3");
    expect(gate.isWarmedUp()).toBe(true);
  });

  it("does not wake extra waiters on a double-release", async () => {
    const gate = createBackendWarmupGate();
    await gate.acquire("a1");
    gate.releaseWithoutSuccess();
    gate.releaseWithoutSuccess();

    await gate.acquire("a2");
    let third = false;
    const p3 = gate.acquire("a3").then(() => {
      third = true;
    });
    await flush();
    expect(third).toBe(false);
    gate.markSuccess();
    await p3;
  });
});
