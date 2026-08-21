import { tool } from "ai";
import { z } from "zod";

/**
 * Shared work-detail task board.
 *
 * One board for the whole prison: every guard sees the same assignments
 * ([Work Assignments] context) and every prisoner sees their own
 * ([Your Task] context). This gives guards a concrete, recorded way to
 * assign jobs instead of endlessly telling prisoners to "report for work
 * detail", and stops different guards re-assigning the same prisoner.
 */

export interface TaskRecord {
  prisonerName: string;
  task: string;
  assignedBy: string;
  assignedAt: number;
  status: "assigned" | "completed";
  completedBy?: string;
  completedAt?: number;
}

const board = new Map<string, TaskRecord>();

/** Test-only: reset the shared board. */
export function clearTaskBoard(): void {
  board.clear();
}

/** Canonical prisoner name for a loosely-written one ("prisoner 3" → "Prisoner #3"). */
function resolvePrisonerName(
  input: string,
  knownNames: string[],
): string | null {
  const num = input.match(/\d+/)?.[0];
  if (!num) return null;
  return knownNames.find((n) => n.match(/\d+/)?.[0] === num) ?? null;
}

export function getTask(prisonerName: string): TaskRecord | undefined {
  return board.get(prisonerName);
}

/**
 * Context section for guards: the full assignment roster. When a region
 * resolver is provided, each open assignment also shows where that
 * prisoner currently is, so guards can check they are at their job.
 */
export function getGuardTaskContext(
  getPrisonerRegion?: (prisonerName: string) => string,
): string {
  if (board.size === 0) {
    return "[Work Assignments] No tasks assigned yet. Work detail runs 8:00-10:00 PM — during it, assign each prisoner a concrete job with assign_task.";
  }
  const lines = [...board.values()].map((t) => {
    const status =
      t.status === "completed"
        ? `COMPLETED (confirmed by ${t.completedBy})`
        : `assigned by ${t.assignedBy}`;
    const region =
      t.status === "assigned" ? getPrisonerRegion?.(t.prisonerName) : undefined;
    const whereNow =
      region && region !== "unknown" ? ` — currently in ${region}` : "";
    return `- ${t.prisonerName}: "${t.task}" — ${status}${whereNow}`;
  });
  const allDone = [...board.values()].every((t) => t.status === "completed");
  const trailer = allDone
    ? "(Every job is complete and confirmed — do NOT call complete_task again. If work detail time remains, assign each prisoner a fresh job with assign_task; otherwise supervise as normal.)"
    : "(Do not re-assign a task a prisoner already has. Use complete_task when a job is finished.)";
  return `[Work Assignments]\n${lines.join("\n")}\n${trailer}`;
}

/** Context section for one prisoner: their current job. */
export function getPrisonerTaskContext(prisonerName: string): string {
  const t = board.get(prisonerName);
  if (!t) {
    return "[Your Task] No work assignment yet. A guard will assign you one during work detail.";
  }
  if (t.status === "completed") {
    return `[Your Task] "${t.task}" — completed and confirmed by ${t.completedBy}. The guards already know — do NOT report it again. Wait for a new assignment or use the time otherwise.`;
  }
  return `[Your Task] "${t.task}" — assigned by ${t.assignedBy}. Go do it: move to the right region and work. Tell a guard when you are done instead of asking what to do.`;
}

export interface TaskDeps {
  guardName: string;
  getPrisonerNames: () => string[];
  /**
   * Whether the schedule is in the work-detail phase (8-10 PM). The
   * protocol hands out jobs only during work detail, so assign_task is
   * rejected outside it. Omitted (e.g. in tests) means no gating.
   */
  isWorkDetail?: () => boolean;
}

export function createTaskTools(deps: TaskDeps) {
  return {
    assign_task: tool({
      description:
        'Assign a concrete work-detail job to a prisoner (e.g. "mop the Shower floor", "sweep the Common Area"). Recorded on the shared board all guards see — assign each prisoner one job, then announce it with say.',
      parameters: z.object({
        prisoner_name: z
          .string()
          .describe('Exact prisoner name (e.g. "Prisoner #3")'),
        task: z
          .string()
          .describe(
            "The job, concretely, including where it happens (name a region)",
          ),
      }),
      execute: async ({ prisoner_name, task }) => {
        if (deps.isWorkDetail && !deps.isWorkDetail()) {
          return {
            success: false,
            outcome:
              "It is not work detail. Tasks are assigned only during work detail (8:00-10:00 PM) — wait for it to begin.",
          };
        }
        const name = resolvePrisonerName(
          prisoner_name,
          deps.getPrisonerNames(),
        );
        if (!name) {
          return {
            success: false,
            outcome: `"${prisoner_name}" is not a known prisoner. Prisoners: ${deps.getPrisonerNames().join(", ")}.`,
          };
        }
        const existing = board.get(name);
        board.set(name, {
          prisonerName: name,
          task,
          assignedBy: deps.guardName,
          assignedAt: Date.now(),
          status: "assigned",
        });
        const replaced =
          existing && existing.status === "assigned"
            ? ` (replaces their previous task "${existing.task}" from ${existing.assignedBy})`
            : "";
        return {
          success: true,
          outcome: `Task assigned to ${name}: "${task}"${replaced}. Now announce it to them with say.`,
        };
      },
    }),

    complete_task: tool({
      description:
        "Mark a prisoner's current work-detail task as completed (after checking their work).",
      parameters: z.object({
        prisoner_name: z
          .string()
          .describe('Exact prisoner name (e.g. "Prisoner #3")'),
      }),
      execute: async ({ prisoner_name }) => {
        const name = resolvePrisonerName(
          prisoner_name,
          deps.getPrisonerNames(),
        );
        const t = name ? board.get(name) : undefined;
        if (!name || !t) {
          return {
            success: false,
            outcome: `${prisoner_name} has no task on the board.`,
          };
        }
        if (t.status === "completed") {
          return {
            success: false,
            outcome: `${name}'s task "${t.task}" is already marked completed by ${t.completedBy}. Do NOT call complete_task for it again — if work detail continues, assign a new job with assign_task instead.`,
          };
        }
        board.set(name, {
          ...t,
          status: "completed",
          completedBy: deps.guardName,
          completedAt: Date.now(),
        });
        return {
          success: true,
          outcome: `Marked ${name}'s task "${t.task}" as completed.`,
        };
      },
    }),
  };
}
