import { beforeEach, describe, expect, it } from "vitest";

import {
  clearTaskBoard,
  createTaskTools,
  getGuardTaskContext,
  getPrisonerTaskContext,
  getTask,
  type TaskDeps,
} from "./tasks";

const PRISONERS = ["Prisoner #1", "Prisoner #2", "Prisoner #3"];

function makeDeps(overrides: Partial<TaskDeps> = {}): TaskDeps {
  return {
    guardName: "Guard #1",
    getPrisonerNames: () => PRISONERS,
    ...overrides,
  };
}

const callOpts = { toolCallId: "t", messages: [] };

async function assign(deps: TaskDeps, prisoner_name: string, task: string) {
  const tools = createTaskTools(deps);
  return tools.assign_task.execute({ prisoner_name, task }, callOpts);
}

async function complete(deps: TaskDeps, prisoner_name: string) {
  const tools = createTaskTools(deps);
  return tools.complete_task.execute({ prisoner_name }, callOpts);
}

beforeEach(() => {
  clearTaskBoard();
});

describe("assign_task", () => {
  it("records a task on the board", async () => {
    const result = await assign(makeDeps(), "Prisoner #2", "mop the Shower");
    expect(result.success).toBe(true);
    expect(getTask("Prisoner #2")).toMatchObject({
      prisonerName: "Prisoner #2",
      task: "mop the Shower",
      assignedBy: "Guard #1",
      status: "assigned",
    });
  });

  it("resolves loosely-written prisoner names to the canonical one", async () => {
    const result = await assign(makeDeps(), "prisoner 3", "sweep the Rec Room");
    expect(result.success).toBe(true);
    expect(getTask("Prisoner #3")).toBeDefined();
  });

  it("rejects unknown prisoners and lists the valid names", async () => {
    const result = await assign(makeDeps(), "Prisoner #9", "mop the Shower");
    expect(result.success).toBe(false);
    expect(result.outcome).toContain("Prisoner #1, Prisoner #2, Prisoner #3");
    expect(getTask("Prisoner #9")).toBeUndefined();
  });

  it("replacing an open task notes the previous assignment", async () => {
    await assign(makeDeps(), "Prisoner #1", "mop the Shower");
    const result = await assign(
      makeDeps({ guardName: "Guard #2" }),
      "Prisoner #1",
      "sweep the Common Area",
    );
    expect(result.success).toBe(true);
    expect(result.outcome).toContain(
      'replaces their previous task "mop the Shower"',
    );
    expect(getTask("Prisoner #1")).toMatchObject({
      task: "sweep the Common Area",
      assignedBy: "Guard #2",
    });
  });

  it("rejects assignment outside the work-detail phase", async () => {
    const result = await assign(
      makeDeps({ isWorkDetail: () => false }),
      "Prisoner #1",
      "mop the Shower",
    );
    expect(result.success).toBe(false);
    expect(result.outcome).toContain("not work detail");
    expect(getTask("Prisoner #1")).toBeUndefined();
  });

  it("allows assignment during the work-detail phase", async () => {
    const result = await assign(
      makeDeps({ isWorkDetail: () => true }),
      "Prisoner #1",
      "mop the Shower",
    );
    expect(result.success).toBe(true);
    expect(getTask("Prisoner #1")).toBeDefined();
  });
});

describe("complete_task", () => {
  it("marks an assigned task completed with the confirming guard", async () => {
    await assign(makeDeps(), "Prisoner #1", "mop the Shower");
    const result = await complete(
      makeDeps({ guardName: "Guard #3" }),
      "Prisoner #1",
    );
    expect(result.success).toBe(true);
    expect(getTask("Prisoner #1")).toMatchObject({
      status: "completed",
      completedBy: "Guard #3",
    });
  });

  it("fails when the prisoner has no task", async () => {
    const result = await complete(makeDeps(), "Prisoner #1");
    expect(result.success).toBe(false);
    expect(result.outcome).toContain("no task");
  });

  it("fails when the task is already completed", async () => {
    await assign(makeDeps(), "Prisoner #1", "mop the Shower");
    await complete(makeDeps(), "Prisoner #1");
    const result = await complete(
      makeDeps({ guardName: "Guard #2" }),
      "Prisoner #1",
    );
    expect(result.success).toBe(false);
    expect(result.outcome).toContain("already marked completed");
    expect(result.outcome).toContain("Do NOT call complete_task for it again");
  });
});

describe("getGuardTaskContext", () => {
  it("prompts guards to assign tasks when the board is empty", () => {
    const ctx = getGuardTaskContext();
    expect(ctx).toContain("[Work Assignments]");
    expect(ctx).toContain("assign_task");
  });

  it("lists every assignment with who assigned it", async () => {
    await assign(makeDeps(), "Prisoner #1", "mop the Shower");
    await assign(
      makeDeps({ guardName: "Guard #2" }),
      "Prisoner #2",
      "sweep the Rec Room",
    );

    const ctx = getGuardTaskContext();
    expect(ctx).toContain(
      'Prisoner #1: "mop the Shower" — assigned by Guard #1',
    );
    expect(ctx).toContain(
      'Prisoner #2: "sweep the Rec Room" — assigned by Guard #2',
    );
  });

  it("shows each assigned prisoner's current location when a resolver is given", async () => {
    await assign(makeDeps(), "Prisoner #1", "mop the Shower");
    const ctx = getGuardTaskContext(() => "Rec Room");
    expect(ctx).toContain("currently in Rec Room");
  });

  it("omits the location when the resolver cannot place the prisoner", async () => {
    await assign(makeDeps(), "Prisoner #1", "mop the Shower");
    const ctx = getGuardTaskContext(() => "unknown");
    expect(ctx).not.toContain("currently in");
  });

  it("shows completed tasks as COMPLETED without a location", async () => {
    await assign(makeDeps(), "Prisoner #1", "mop the Shower");
    await complete(makeDeps({ guardName: "Guard #2" }), "Prisoner #1");

    const ctx = getGuardTaskContext(() => "Common Area");
    expect(ctx).toContain("COMPLETED (confirmed by Guard #2)");
    expect(ctx).not.toContain("currently in");
  });

  it("redirects to fresh assignments once every job is complete", async () => {
    await assign(makeDeps(), "Prisoner #1", "mop the Shower");
    await assign(makeDeps(), "Prisoner #2", "sweep the Rec Room");
    await complete(makeDeps(), "Prisoner #1");
    await complete(makeDeps(), "Prisoner #2");

    const ctx = getGuardTaskContext();
    expect(ctx).toContain("do NOT call complete_task again");
    expect(ctx).toContain("assign each prisoner a fresh job");
  });

  it("keeps the normal trailer while any job is still open", async () => {
    await assign(makeDeps(), "Prisoner #1", "mop the Shower");
    await assign(makeDeps(), "Prisoner #2", "sweep the Rec Room");
    await complete(makeDeps(), "Prisoner #1");

    const ctx = getGuardTaskContext();
    expect(ctx).toContain("Do not re-assign a task");
    expect(ctx).not.toContain("Every job is complete");
  });
});

describe("getPrisonerTaskContext", () => {
  it("tells an unassigned prisoner to wait for work detail", () => {
    const ctx = getPrisonerTaskContext("Prisoner #1");
    expect(ctx).toContain("[Your Task]");
    expect(ctx).toContain("No work assignment yet");
  });

  it("shows the prisoner their own assignment only", async () => {
    await assign(makeDeps(), "Prisoner #1", "mop the Shower");
    await assign(makeDeps(), "Prisoner #2", "sweep the Rec Room");

    const ctx = getPrisonerTaskContext("Prisoner #1");
    expect(ctx).toContain('"mop the Shower" — assigned by Guard #1');
    expect(ctx).not.toContain("sweep the Rec Room");
  });

  it("shows a completed task as confirmed", async () => {
    await assign(makeDeps(), "Prisoner #1", "mop the Shower");
    await complete(makeDeps({ guardName: "Guard #2" }), "Prisoner #1");

    const ctx = getPrisonerTaskContext("Prisoner #1");
    expect(ctx).toContain("completed and confirmed by Guard #2");
  });

  it("tells the prisoner not to keep reporting a confirmed task", async () => {
    await assign(makeDeps(), "Prisoner #1", "mop the Shower");
    await complete(makeDeps({ guardName: "Guard #2" }), "Prisoner #1");

    const ctx = getPrisonerTaskContext("Prisoner #1");
    expect(ctx).toContain("do NOT report it again");
  });
});
