import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getCurrentGameTime, initSimulationTime, realToSimTime } from "./time";

describe("realToSimTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 12, 10, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null before the simulation starts", () => {
    expect(realToSimTime(Date.now())).toBeNull();
    expect(getCurrentGameTime()).toBeNull();
  });

  it("maps the start timestamp to 6:00 PM and runs at 2x realtime", () => {
    initSimulationTime();
    const start = Date.now();

    const atStart = realToSimTime(start)!;
    expect(atStart.getHours()).toBe(18);
    expect(atStart.getMinutes()).toBe(0);

    // 30 real minutes later = 60 sim minutes later
    const later = realToSimTime(start + 30 * 60 * 1000)!;
    expect(later.getHours()).toBe(19);
    expect(later.getMinutes()).toBe(0);
  });

  it("agrees with getCurrentGameTime for the present moment", () => {
    initSimulationTime();
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(realToSimTime(Date.now())!.getTime()).toBe(
      getCurrentGameTime()!.getTime(),
    );
  });
});
