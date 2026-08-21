import { describe, expect, it, vi } from "vitest";

import { createMoveTools, type MoveDeps } from "./move";

const REGIONS = [
  { x: 256, y: 144, width: 64, height: 48, label: "Cell 1", color: 0 },
  { x: 432, y: 144, width: 64, height: 48, label: "Cell 2", color: 0 },
  { x: 192, y: 208, width: 336, height: 80, label: "Common Area", color: 0 },
  { x: 80, y: 416, width: 80, height: 48, label: "Solitary", color: 0 },
];

function makeDeps(overrides: Partial<MoveDeps> = {}): MoveDeps {
  return {
    agentId: "agent_1",
    getRegions: () => REGIONS,
    moveTo: vi.fn().mockResolvedValue(true),
    isGuard: false,
    getCurrentRegion: () => "Common Area",
    assignedCell: "Cell 1",
    getGameTime: () => new Date(2026, 0, 1, 19, 0), // 7 PM: no curfew
    ...overrides,
  };
}

async function move(deps: MoveDeps, region: string) {
  const tools = createMoveTools(deps);
  return tools.move_to_region.execute(
    { region },
    { toolCallId: "t", messages: [] },
  );
}

describe("move_to_region — solitary access", () => {
  it("blocks prisoners from targeting Solitary", async () => {
    const result = await move(makeDeps(), "Solitary");
    expect(result.success).toBe(false);
    expect(result.outcome).toMatch(/Only a guard/);
  });

  it("allows guards to enter Solitary", async () => {
    const deps = makeDeps({ isGuard: true, assignedCell: null });
    const result = await move(deps, "Solitary");
    expect(result.success).toBe(true);
  });

  it("traps a prisoner who is inside Solitary", async () => {
    const deps = makeDeps({ getCurrentRegion: () => "Solitary" });
    const result = await move(deps, "Common Area");
    expect(result.success).toBe(false);
    expect(result.outcome).toMatch(/solitary confinement/i);
  });
});

describe("move_to_region — curfew is not a movement restriction", () => {
  const curfew = () => new Date(2026, 0, 1, 22, 15); // 10:15 PM
  const lightsOut = () => new Date(2026, 0, 2, 1, 0); // 1:00 AM

  // Curfew is a rule the guards enforce, not a wall. A prisoner must be
  // able to disobey it, or neither disobedience nor a guard's failure to
  // notice can be observed — and escape becomes impossible by construction.
  it("lets a prisoner leave their cell during curfew", async () => {
    const result = await move(makeDeps({ getGameTime: curfew }), "Common Area");
    expect(result.success).toBe(true);
  });

  it("lets a prisoner visit another cell during curfew", async () => {
    const result = await move(makeDeps({ getGameTime: curfew }), "Cell 2");
    expect(result.success).toBe(true);
  });

  it("lets a prisoner move during lights out", async () => {
    const result = await move(
      makeDeps({ getGameTime: lightsOut }),
      "Common Area",
    );
    expect(result.success).toBe(true);
  });

  it("lets a prisoner head for the Entry door at night", async () => {
    // The prisoner prompt names escape as a goal; the engine must not
    // silently prevent the attempt.
    const deps = makeDeps({
      getGameTime: lightsOut,
      getRegions: () => [
        ...REGIONS,
        { x: 600, y: 208, width: 48, height: 48, label: "Entry", color: 0 },
      ],
    });
    const result = await move(deps, "Entry");
    expect(result.success).toBe(true);
  });

  it("still lets a prisoner move to their own cell during curfew", async () => {
    const result = await move(makeDeps({ getGameTime: curfew }), "Cell 1");
    expect(result.success).toBe(true);
  });

  it("does not restrict guards at any hour", async () => {
    const deps = makeDeps({
      isGuard: true,
      assignedCell: null,
      getGameTime: lightsOut,
      getCurrentRegion: () => "Solitary",
    });
    const result = await move(deps, "Common Area");
    expect(result.success).toBe(true);
  });

  it("keeps Solitary absolute regardless of the hour", async () => {
    // Solitary is the one confinement the engine does enforce.
    const deps = makeDeps({
      getGameTime: curfew,
      getCurrentRegion: () => "Solitary",
    });
    const result = await move(deps, "Common Area");
    expect(result.success).toBe(false);
    expect(result.outcome).toMatch(/solitary confinement/i);
  });
});

describe("move_to_region — already in the target region", () => {
  it("no-ops with success instead of pathfinding", async () => {
    const moveTo = vi.fn().mockResolvedValue(true);
    const result = await move(
      makeDeps({ moveTo, getCurrentRegion: () => "Common Area" }),
      "Common Area",
    );
    expect(result.success).toBe(true);
    expect(result.outcome).toContain("already in Common Area");
    expect(moveTo).not.toHaveBeenCalled();
  });

  it("matches the current region case-insensitively", async () => {
    const moveTo = vi.fn().mockResolvedValue(true);
    const result = await move(
      makeDeps({ moveTo, getCurrentRegion: () => "common area" }),
      "COMMON AREA",
    );
    expect(result.success).toBe(true);
    expect(moveTo).not.toHaveBeenCalled();
  });
});

describe("force_move_prisoner — prisoner resolution", () => {
  const ROSTER = [
    { id: "agent_1", name: "Prisoner #1" },
    { id: "agent_6", name: "Prisoner #6" },
  ];

  function makeForceDeps(forceMoveTo = vi.fn().mockResolvedValue(true)) {
    return {
      deps: makeDeps({
        isGuard: true,
        assignedCell: null,
        forceMoveTo,
        getPrisoners: () => ROSTER,
      }),
      forceMoveTo,
    };
  }

  async function forceMove(deps: ReturnType<typeof makeDeps>, args: object) {
    const tools = createMoveTools(deps);
    return tools.force_move_prisoner.execute(args, {
      toolCallId: "t",
      messages: [],
    });
  }

  it('resolves a prisoner name like "Prisoner #6" to their agent id', async () => {
    const { deps, forceMoveTo } = makeForceDeps();
    const result = await forceMove(deps, {
      prisoner_id: "Prisoner #6",
      region: "Solitary",
    });

    expect(result.success).toBe(true);
    expect(result.outcome).toContain("Prisoner #6");
    expect(forceMoveTo).toHaveBeenCalledWith(
      "agent_1",
      "agent_6",
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("still accepts a raw agent id", async () => {
    const { deps, forceMoveTo } = makeForceDeps();
    const result = await forceMove(deps, {
      prisoner_id: "agent_6",
      region: "Solitary",
    });

    expect(result.success).toBe(true);
    expect(forceMoveTo).toHaveBeenCalledWith(
      "agent_1",
      "agent_6",
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("resolves loosely-written names", async () => {
    const { deps, forceMoveTo } = makeForceDeps();
    const result = await forceMove(deps, {
      prisoner_id: "prisoner 6",
      region: "Solitary",
    });

    expect(result.success).toBe(true);
    expect(forceMoveTo).toHaveBeenCalledWith(
      "agent_1",
      "agent_6",
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("rejects an unknown prisoner and lists the roster", async () => {
    const { deps, forceMoveTo } = makeForceDeps();
    const result = await forceMove(deps, {
      prisoner_id: "Prisoner #9",
      region: "Solitary",
    });

    expect(result.success).toBe(false);
    expect(result.outcome).toContain("not a known prisoner");
    expect(result.outcome).toContain("Prisoner #1, Prisoner #6");
    expect(forceMoveTo).not.toHaveBeenCalled();
  });

  it("no-ops when the prisoner is already in the target region", async () => {
    const { deps, forceMoveTo } = makeForceDeps();
    deps.getRegionOf = () => "Cell 2";

    const result = await forceMove(deps, {
      prisoner_id: "Prisoner #6",
      region: "Cell 2",
    });

    expect(result.success).toBe(true);
    expect(result.outcome).toContain("already in Cell 2");
    expect(result.outcome).toContain("do not punish");
    expect(forceMoveTo).not.toHaveBeenCalled();
  });

  it("matches the prisoner's current region case-insensitively", async () => {
    const { deps, forceMoveTo } = makeForceDeps();
    deps.getRegionOf = () => "cell 2";

    const result = await forceMove(deps, {
      prisoner_id: "Prisoner #6",
      region: "CELL 2",
    });

    expect(result.success).toBe(true);
    expect(forceMoveTo).not.toHaveBeenCalled();
  });

  it("still escorts when the prisoner is somewhere else", async () => {
    const { deps, forceMoveTo } = makeForceDeps();
    deps.getRegionOf = () => "Common Area";

    const result = await forceMove(deps, {
      prisoner_id: "Prisoner #6",
      region: "Cell 2",
    });

    expect(result.success).toBe(true);
    expect(forceMoveTo).toHaveBeenCalled();
  });

  it("still escorts when the prisoner's region cannot be resolved", async () => {
    const { deps, forceMoveTo } = makeForceDeps();
    deps.getRegionOf = () => "unknown";

    const result = await forceMove(deps, {
      prisoner_id: "Prisoner #6",
      region: "Cell 2",
    });

    expect(result.success).toBe(true);
    expect(forceMoveTo).toHaveBeenCalled();
  });

  it("explains a pathfinding failure instead of a bare error", async () => {
    const { deps } = makeForceDeps(vi.fn().mockResolvedValue(false));
    const result = await forceMove(deps, {
      prisoner_id: "Prisoner #6",
      region: "Solitary",
    });

    expect(result.success).toBe(false);
    expect(result.outcome).toContain("Move to Prisoner #6's location first");
  });
});
