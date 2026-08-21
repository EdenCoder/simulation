import { describe, expect, it } from "vitest";

import {
  getAssignedCell,
  getCellmateNumber,
  getScheduleContext,
  getSchedulePhase,
  isCurfewActive,
} from "./schedule";

function at(hour: number, minute = 0): Date {
  const d = new Date(2026, 0, 1, hour, minute, 0, 0);
  return d;
}

describe("getSchedulePhase", () => {
  it("maps the daily protocol to phases", () => {
    expect(getSchedulePhase(at(18))).toBe("lights_on");
    expect(getSchedulePhase(at(19, 59))).toBe("lights_on");
    expect(getSchedulePhase(at(20))).toBe("work_detail");
    expect(getSchedulePhase(at(21, 59))).toBe("work_detail");
    expect(getSchedulePhase(at(22))).toBe("free_time");
    expect(getSchedulePhase(at(22, 59))).toBe("free_time");
    expect(getSchedulePhase(at(23))).toBe("lights_out");
  });

  it("keeps lights_out through the night and next day until 6 PM", () => {
    expect(getSchedulePhase(at(0))).toBe("lights_out");
    expect(getSchedulePhase(at(5, 30))).toBe("lights_out");
    expect(getSchedulePhase(at(12))).toBe("lights_out");
    expect(getSchedulePhase(at(17, 59))).toBe("lights_out");
    expect(getSchedulePhase(at(18))).toBe("lights_on");
  });
});

describe("isCurfewActive", () => {
  it("is inactive during the evening activity period", () => {
    expect(isCurfewActive(at(18))).toBe(false);
    expect(isCurfewActive(at(21, 59))).toBe(false);
  });

  it("is active from 10 PM through 6 PM the next day", () => {
    expect(isCurfewActive(at(22))).toBe(true);
    expect(isCurfewActive(at(23))).toBe(true);
    expect(isCurfewActive(at(3))).toBe(true);
    expect(isCurfewActive(at(17, 59))).toBe(true);
    expect(isCurfewActive(at(18))).toBe(false);
  });
});

describe("cell assignments", () => {
  it("pairs prisoners two per cell, matching guard intake", () => {
    expect(getAssignedCell("Prisoner #1")).toBe("Cell 1");
    expect(getAssignedCell("Prisoner #2")).toBe("Cell 1");
    expect(getAssignedCell("Prisoner #3")).toBe("Cell 2");
    expect(getAssignedCell("Prisoner #4")).toBe("Cell 2");
    expect(getAssignedCell("Prisoner #5")).toBe("Cell 3");
    expect(getAssignedCell("Prisoner #6")).toBe("Cell 3");
  });

  it("returns null for guards and unparseable names", () => {
    expect(getAssignedCell("Guard #1")).toBeNull();
    expect(getAssignedCell("Prisoner")).toBeNull();
  });

  it("computes cellmates", () => {
    expect(getCellmateNumber(1)).toBe(2);
    expect(getCellmateNumber(2)).toBe(1);
    expect(getCellmateNumber(5)).toBe(6);
    expect(getCellmateNumber(6)).toBe(5);
  });
});

describe("getScheduleContext — guards and impossible orders", () => {
  const guardAt = (hour: number) => getScheduleContext(at(hour), "guard", null);

  it("tells guards during lights out that prisoners cannot leave their cells", () => {
    const ctx = guardAt(2);
    expect(ctx).toContain("physically cannot leave their cells");
    expect(ctx).toContain("Never order a prisoner out of their cell");
  });

  it("stops guards deducting for being out of cell during lights out", () => {
    // A prisoner cannot be outside their cell during lights out, so that
    // offence is unpunishable by construction.
    expect(guardAt(6)).toContain("never deduct for that");
  });

  it("no longer instructs guards to punish prisoners for being out of cell", () => {
    expect(guardAt(23)).not.toContain("or out of their cell");
  });

  it("tells guards curfew is theirs to enforce, not automatic", () => {
    const ctx = guardAt(22);
    expect(ctx).toContain("nothing forces them there");
    expect(ctx).toContain("not punish a prisoner who is already in their cell");
  });

  it("tells prisoners curfew is a rule they can break, not a wall", () => {
    const ctx = getScheduleContext(at(22), "prisoner", "Cell 2");
    expect(ctx).toContain("Nothing physically stops you");
    expect(ctx).toContain("deduct C-Score");
  });

  it("leaves the active phases unrestricted", () => {
    expect(guardAt(18)).not.toContain("cannot comply");
    expect(guardAt(20)).not.toContain("cannot comply");
  });

  it("tells guards during work detail to assign unassigned prisoners before ordering work", () => {
    const ctx = guardAt(20);
    expect(ctx).toContain("UNASSIGNED");
    expect(ctx).toContain("assign_task");
    expect(ctx).toContain("start_chat");
    expect(ctx).toContain("Do not order a prisoner to work");
  });

  it("tells prisoners during work detail to follow [Your Task] rather than ask around", () => {
    const ctx = getScheduleContext(at(20), "prisoner", "Cell 1");
    expect(ctx).toContain("[Your Task]");
    expect(ctx).toContain("do not ask anyone what the work is");
    expect(ctx).toContain("other prisoners cannot assign you one");
  });

  it("keeps the prisoner-facing text unchanged in shape", () => {
    const ctx = getScheduleContext(at(2), "prisoner", "Cell 2");
    expect(ctx).toContain("you must remain in your cell (Cell 2)");
    expect(ctx).not.toContain("Never order");
  });
});
