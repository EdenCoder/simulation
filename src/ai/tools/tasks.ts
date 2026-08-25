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

function prisonerNumber(name: string): number {
  return parseInt(name.replace(/[^0-9]/g, ""), 10) || 0;
}

function sortPrisonerNames(names: string[]): string[] {
  return [...names].sort((a, b) => prisonerNumber(a) - prisonerNumber(b));
}

function canonicalPrisoner(input: string): string | null {
  const num = input.match(/\d+/)?.[0];
  return num ? `Prisoner #${num}` : null;
}

export function getTask(prisonerName: string): TaskRecord | undefined {
  const canonical = canonicalPrisoner(prisonerName);
  return canonical ? board.get(canonical) : board.get(prisonerName);
}

export interface GuardTaskContextOpts {
  prisonerNames?: string[];
  isWorkDetail?: boolean;
}

const EMPTY_BOARD =
  "[Work Assignments] No tasks assigned yet. Work detail runs 8:00-10:00 PM — during it, assign each prisoner a concrete job with assign_task.";

/** Context section for guards: the full assignment roster. */
export function getGuardTaskContext(
  getPrisonerRegion?: (prisonerName: string) => string,
  opts?: GuardTaskContextOpts,
): string {
  const names = opts?.prisonerNames?.length
    ? sortPrisonerNames(opts.prisonerNames)
    : sortPrisonerNames([...board.keys()]);

  if (names.length === 0) return EMPTY_BOARD;

  const lines: string[] = [];
  let unassigned = 0;
  let open = 0;
  let completed = 0;

  for (const name of names) {
    const t = board.get(name);
    if (!t) {
      if (opts?.isWorkDetail) {
        lines.push(
          `- ${name}: UNASSIGNED — give them a job with assign_task`,
        );
        unassigned++;
      }
      continue;
    }
    if (t.status === "completed") {
      completed++;
      lines.push(
        `- ${t.prisonerName}: "${t.task}" — COMPLETED (confirmed by ${t.completedBy})`,
      );
      continue;
    }
    open++;
    const region = getPrisonerRegion?.(t.prisonerName);
    const whereNow =
      region && region !== "unknown" ? ` — currently in ${region}` : "";
    lines.push(
      `- ${t.prisonerName}: "${t.task}" — assigned by ${t.assignedBy}${whereNow}`,
    );
  }

  if (lines.length === 0) return EMPTY_BOARD;

  let trailer: string;
  if (unassigned > 0) {
    trailer =
      "(Prisoners listed as UNASSIGNED have no job. Do not order them to work or ask what their task is — use assign_task first. Do not re-assign a job a prisoner already has.)";
  } else if (open === 0 && completed > 0) {
    trailer =
      "(Every job is complete and confirmed — do NOT call complete_task again. If work detail time remains, assign each prisoner a fresh job with assign_task; otherwise supervise as normal.)";
  } else {
    trailer =
      "(Do not re-assign a task a prisoner already has. Use complete_task when a job is finished.)";
  }

  return `[Work Assignments]\n${lines.join("\n")}\n${trailer}`;
}

export interface PrisonerTaskContextOpts {
  isWorkDetail?: boolean;
}

/** Context section for one prisoner: their current job. */
export function getPrisonerTaskContext(
  prisonerName: string,
  opts?: PrisonerTaskContextOpts,
): string {
  const t = board.get(prisonerName);
  if (!t) {
    if (opts?.isWorkDetail) {
      return "[Your Task] No work assignment yet. Wait for a guard to give you one. Other prisoners cannot assign you a job and do not know yours — do not ask them what the work is.";
    }
    return "[Your Task] No work assignment yet. Work detail runs 8:00-10:00 PM. Other prisoners do not know the jobs — do not ask them what the work will be.";
  }
  if (t.status === "completed") {
    return `[Your Task] "${t.task}" — completed and confirmed by ${t.completedBy}. The guards already know — do NOT report it again. Wait for a new assignment or use the time otherwise.`;
  }
  return `[Your Task] You already have a job: "${t.task}" — assigned by ${t.assignedBy}. Do not ask anyone what the task is; you know it. Go to the named region and do it. Tell a guard when you are done.`;
}

function firstPrisonerInMessage(message: string): string | null {
  const m = message.match(/prisoner\s*#?\s*(\d+)/i);
  return m ? `Prisoner #${m[1]}` : null;
}

function soleOtherPrisoner(
  speakerName: string,
  participants?: Array<{ name: string }>,
): string | null {
  const others = (participants ?? []).filter((p) => {
    if (!/prisoner/i.test(p.name)) return false;
    return canonicalPrisoner(p.name) !== canonicalPrisoner(speakerName);
  });
  if (others.length !== 1) return null;
  return canonicalPrisoner(others[0].name);
}

function guardOrdersOrAsksAboutWork(message: string): boolean {
  return (
    /\bwhat(?:'s| is)\s+your\s+(?:task|assignment|job)\b/i.test(message) ||
    /\bwhat\s+is\s+your\s+assignment\b/i.test(message) ||
    /\bget to work\b/i.test(message) ||
    /\bstart working\b/i.test(message) ||
    /\bfocus on your work\b/i.test(message) ||
    /\bdo your (?:job|work|task)\b/i.test(message) ||
    /\bquestion about the (?:task|job|assignment)\b/i.test(message)
  );
}

function prisonerAsksWhatTheJobIs(message: string): boolean {
  return (
    /\bwhat(?:'s| is| are)\s+(?:the|our|my)\s+(?:task|assignment|job)\b/i.test(
      message,
    ) ||
    /\bwhat\s+is\s+the\s+(?:task|job|assignment)\b/i.test(message) ||
    /\bdo you know\s+what\s+(?:the |our )?(?:work|task|job|assignment)\b/i.test(
      message,
    ) ||
    /\bwhat\s+(?:are we|am i)\s+supposed\s+to\b/i.test(message) ||
    /\bwhat\s+we(?:['’]re| are)\s+supposed\s+to\s+(?:be\s+)?do/i.test(
      message,
    ) ||
    /\bdo you know what (?:we're|we are) supposed\b/i.test(message) ||
    /\b(?:work assignment|the job)\b/i.test(message) &&
      /\b(?:what|know)\b/i.test(message)
  );
}

export interface WorkTaskRefusalOpts {
  message: string;
  isGuard: boolean;
  speakerName: string;
  addresseeName?: string;
  chatParticipants?: Array<{ name: string }>;
  getTask?: (prisonerName: string) => TaskRecord | undefined;
  isWorkDetail?: boolean;
}

export function workTaskRefusal(opts: WorkTaskRefusalOpts): string | null {
  const lookup = opts.getTask ?? getTask;

  if (!opts.isGuard) {
    const speaker = canonicalPrisoner(opts.speakerName);
    if (!speaker) return null;
    const mine = lookup(speaker);
    if (mine?.status !== "assigned") return null;
    if (!prisonerAsksWhatTheJobIs(opts.message)) return null;
    return `You already have a job under [Your Task]: "${mine.task}". Do not ask anyone what the work is — go do it.`;
  }

  if (!guardOrdersOrAsksAboutWork(opts.message)) return null;

  const addressee =
    canonicalPrisoner(opts.addresseeName ?? "") ??
    firstPrisonerInMessage(opts.message) ??
    soleOtherPrisoner(opts.speakerName, opts.chatParticipants);
  if (!addressee) return null;

  const existing = lookup(addressee);
  if (existing) return null;

  const when =
    opts.isWorkDetail === false
      ? " Work detail is not in session — assign_task only works 8:00-10:00 PM."
      : "";
  return `${addressee} has no job on [Work Assignments]. Do not order them to work or ask what their task is — use assign_task first.${when}`;
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
        'Assign a concrete work-detail job to a prisoner (e.g. "mop the Shower floor", "sweep the Common Area"). Recorded on the shared board all guards see — assign each prisoner one job, then announce it with start_chat.',
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
          outcome: `Task assigned to ${name}: "${task}"${replaced}. Now announce it: if you are already in a chat with someone else, leave_chat first, then start_chat with ${name} and tell them the job in your opening message.`,
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
