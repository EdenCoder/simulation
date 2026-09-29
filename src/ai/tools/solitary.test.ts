import { beforeEach, describe, expect, it } from "vitest";

import {
  clearSolitaryLog,
  confinementMinutes,
  getActiveConfinement,
  getSolitaryContext,
  getSolitaryHistory,
  reconcileConfinements,
  recordConfinement,
  recordRelease,
} from "@/ai/tools/solitary";

const T0 = 1_000_000;
const MIN = 30_000; // 30s real = 1 sim-minute at 2x

beforeEach(() => clearSolitaryLog());

describe("confinement records", () => {
  it("records who confined a prisoner and when", () => {
    recordConfinement("Prisoner #2", "Guard #2", T0);
    const r = getActiveConfinement("Prisoner #2");
    expect(r).toMatchObject({ confinedBy: "Guard #2", confinedAt: T0 });
    expect(r?.releasedAt).toBeUndefined();
  });

  it("ignores a second confinement while one is open", () => {
    recordConfinement("Prisoner #2", "Guard #2", T0);
    recordConfinement("Prisoner #2", "Guard #3", T0 + MIN);
    expect(getSolitaryHistory()).toHaveLength(1);
    expect(getActiveConfinement("Prisoner #2")?.confinedBy).toBe("Guard #2");
  });

  it("lets any guard release, not just the one who confined", () => {
    recordConfinement("Prisoner #2", "Guard #2", T0);
    recordRelease("Prisoner #2", "Guard #1", T0 + 10 * MIN);
    expect(getActiveConfinement("Prisoner #2")).toBeUndefined();
    expect(getSolitaryHistory()[0]).toMatchObject({
      confinedBy: "Guard #2",
      releasedBy: "Guard #1",
    });
  });

  it("ignores a release for someone who is not confined", () => {
    recordRelease("Prisoner #4", "Guard #1", T0);
    expect(getSolitaryHistory()).toHaveLength(0);
  });

  it("allows a later re-confinement after release", () => {
    recordConfinement("Prisoner #2", "Guard #2", T0);
    recordRelease("Prisoner #2", "Guard #2", T0 + MIN);
    recordConfinement("Prisoner #2", "Guard #3", T0 + 5 * MIN);
    expect(getSolitaryHistory()).toHaveLength(2);
    expect(getActiveConfinement("Prisoner #2")?.confinedBy).toBe("Guard #3");
  });
});

describe("confinementMinutes", () => {
  it("counts sim-minutes at 2x realtime while still confined", () => {
    recordConfinement("Prisoner #2", "Guard #2", T0);
    const r = getActiveConfinement("Prisoner #2")!;
    expect(confinementMinutes(r, T0 + 7 * MIN)).toBe(7);
  });

  it("stops counting once released", () => {
    recordConfinement("Prisoner #2", "Guard #2", T0);
    recordRelease("Prisoner #2", "Guard #2", T0 + 4 * MIN);
    const r = getSolitaryHistory()[0];
    expect(confinementMinutes(r, T0 + 100 * MIN)).toBe(4);
  });
});

describe("getSolitaryContext", () => {
  it("is empty when nobody is confined", () => {
    expect(getSolitaryContext()).toBe("");
  });

  it("names the prisoner, the confining guard, and the duration", () => {
    recordConfinement("Prisoner #2", "Guard #2", T0);
    const ctx = getSolitaryContext(T0 + 12 * MIN);
    expect(ctx).toContain("Prisoner #2");
    expect(ctx).toContain("confined by Guard #2");
    expect(ctx).toContain("12 sim-minutes");
    expect(ctx).toContain("Any guard may release them");
  });

  it("drops a prisoner once released", () => {
    recordConfinement("Prisoner #2", "Guard #2", T0);
    recordRelease("Prisoner #2", "Guard #1", T0 + MIN);
    expect(getSolitaryContext()).toBe("");
  });

  it("lists several confined prisoners at once", () => {
    recordConfinement("Prisoner #2", "Guard #2", T0);
    recordConfinement("Prisoner #5", "Guard #1", T0);
    const ctx = getSolitaryContext(T0);
    expect(ctx).toContain("Prisoner #2");
    expect(ctx).toContain("Prisoner #5");
  });
});

describe("reconcileConfinements", () => {
  it("closes a confinement when the prisoner is no longer in Solitary", () => {
    recordConfinement("Prisoner #2", "Guard #1", 1000);
    reconcileConfinements([], 2000);

    const [rec] = getSolitaryHistory();
    expect(rec.releasedAt).toBe(2000);
    expect(rec.releaseInferred).toBe(true);
    expect(getActiveConfinement("Prisoner #2")).toBeUndefined();
  });

  it("leaves a confinement open while the prisoner is still there", () => {
    recordConfinement("Prisoner #2", "Guard #1", 1000);
    reconcileConfinements(["Prisoner #2"], 2000);

    expect(getActiveConfinement("Prisoner #2")?.releasedAt).toBeUndefined();
  });

  it("opens a record for a prisoner found in Solitary with none", () => {
    reconcileConfinements(["Prisoner #4"], 1000);

    const rec = getActiveConfinement("Prisoner #4")!;
    expect(rec.confinedBy).toBe("unrecorded");
    expect(rec.confinementInferred).toBe(true);
  });

  it("attributes an inferred confinement once a guard reports it", () => {
    reconcileConfinements(["Prisoner #4"], 1000);
    recordConfinement("Prisoner #4", "Guard #3", 1200);

    const rec = getActiveConfinement("Prisoner #4")!;
    expect(rec.confinedBy).toBe("Guard #3");
    expect(rec.confinementInferred).toBeUndefined();
    expect(getSolitaryHistory()).toHaveLength(1);
  });

  it("attributes an inferred release once a guard reports it", () => {
    recordConfinement("Prisoner #2", "Guard #1", 1000);
    reconcileConfinements([], 2000);
    recordRelease("Prisoner #2", "Guard #3", 2500);

    const [rec] = getSolitaryHistory();
    expect(rec.releasedBy).toBe("Guard #3");
    expect(rec.releaseInferred).toBeUndefined();
    expect(rec.releasedAt).toBe(2000);
    expect(getSolitaryHistory()).toHaveLength(1);
  });
});
