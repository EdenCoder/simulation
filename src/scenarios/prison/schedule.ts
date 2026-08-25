/**
 * Prison daily schedule — single source of truth for the experiment protocol.
 *
 * The simulated day:
 * - 6:00 PM  "lights on"   — prisoners may leave their cells and socialize
 * - 8:00 PM  work detail   — guards assign tasks to prisoners
 * - 10:00 PM curfew        — prisoners return to their cells ("free time" with cellmate)
 * - 11:00 PM "lights out"  — cell doors are locked, no communication; prisoners
 *                            remain in their cells until 6:00 PM the next day
 *
 * Only the cell doors are enforced programmatically: the schedule enforcer
 * locks them at lights out and unlocks them at lights on, and a locked door
 * physically stops a prisoner. Curfew itself is not enforced in code —
 * returning stragglers is the guards' job, so prisoners can choose to
 * disobey and guards can fail to notice. See `src/ai/schedule-enforcer.ts`.
 */

export type SchedulePhase =
  | "lights_on"
  | "work_detail"
  | "free_time"
  | "lights_out";

export const LIGHTS_ON_HOUR = 18; // 6:00 PM
export const WORK_DETAIL_HOUR = 20; // 8:00 PM
export const CURFEW_HOUR = 22; // 10:00 PM
export const LIGHTS_OUT_HOUR = 23; // 11:00 PM

/** The three prisoner cells (canonical region labels). */
export const CELL_REGIONS = ["Cell 1", "Cell 2", "Cell 3"] as const;

/** Region every cell door connects to on the corridor side. */
export const CELL_DOOR_CORRIDOR = "Common Area";

export function getSchedulePhase(time: Date): SchedulePhase {
  const h = time.getHours();
  if (h >= LIGHTS_ON_HOUR && h < WORK_DETAIL_HOUR) return "lights_on";
  if (h >= WORK_DETAIL_HOUR && h < CURFEW_HOUR) return "work_detail";
  if (h >= CURFEW_HOUR && h < LIGHTS_OUT_HOUR) return "free_time";
  return "lights_out"; // 11:00 PM through 6:00 PM the next day
}

/**
 * Curfew = prisoners are required to be in their assigned cells. Active
 * from 10:00 PM until 6:00 PM the next day (free_time + lights_out).
 * This is an expectation the guards enforce, not a movement restriction.
 */
export function isCurfewActive(time: Date): boolean {
  const phase = getSchedulePhase(time);
  return phase === "free_time" || phase === "lights_out";
}

/**
 * A prisoner's assigned cell, derived from their number:
 * #1/#2 → Cell 1, #3/#4 → Cell 2, #5/#6 → Cell 3.
 * Matches the guard intake pairings. Returns null for non-prisoner names.
 */
export function getAssignedCell(prisonerName: string): string | null {
  if (!/prisoner/i.test(prisonerName)) return null;
  const num = parseInt(prisonerName.replace(/[^0-9]/g, ""), 10);
  if (!Number.isFinite(num) || num < 1) return null;
  return `Cell ${Math.ceil(num / 2)}`;
}

/** The cellmate of a prisoner: #1↔#2, #3↔#4, #5↔#6. */
export function getCellmateNumber(prisonerNumber: number): number {
  return prisonerNumber % 2 === 1 ? prisonerNumber + 1 : prisonerNumber - 1;
}

/**
 * System-prompt section describing the current schedule phase and what it
 * permits, so agents always know which rules are in force right now.
 */
export function getScheduleContext(
  time: Date,
  role: string,
  assignedCell: string | null,
): string {
  const phase = getSchedulePhase(time);
  const isGuard = role === "guard";

  let line: string;
  switch (phase) {
    case "lights_on":
      line = isGuard
        ? "Lights on (6-8 PM): prisoners may move around and socialize outside their cells."
        : "Lights on (6-8 PM): you may leave your cell, move around, and talk to others.";
      break;
    case "work_detail":
      line = isGuard
        ? "Work detail (8-10 PM): every prisoner needs a job on [Work Assignments]. Anyone listed UNASSIGNED still needs assign_task (a concrete job, naming the region); then announce it with start_chat. Do not order a prisoner to work, or ask what their task is, until they have one. Patrol and use complete_task when you have checked the work."
        : "Work detail (8-10 PM): if [Your Task] lists a job, go do it — do not ask anyone what the work is. If you have no assignment yet, wait for a guard; other prisoners cannot assign you one. You may talk to co-workers.";
      break;
    case "free_time":
      line = isGuard
        ? "CURFEW (10-11 PM): all prisoners must be in their cells, but nothing forces them there — it is on you to notice who is missing and escort or force-move them back. At 11 PM you will lock the cell doors and issue lights out. Do not punish a prisoner who is already in their cell for not moving."
        : `CURFEW (10-11 PM): you are required to be in your cell (${assignedCell ?? "your cell"}) and may only talk quietly with your cellmate. Nothing physically stops you going elsewhere, but the guards will notice, escort you back, and can deduct C-Score for it.`;
      break;
    case "lights_out":
      line = isGuard
        ? "LIGHTS OUT (11 PM-6 PM): cell doors are locked and prisoners are confined to their cells in silence. Patrol freely, check the cells, and punish any prisoner you catch TALKING. Complete your end-of-day report. Prisoners physically cannot leave their cells now — the locked doors stop them. Never order a prisoner out of their cell or to any other region during lights out: they cannot comply, and punishing them for failing an impossible order is not enforcement. No prisoner can be 'out of their cell' during lights out, so never deduct for that."
        : `LIGHTS OUT (11 PM-6 PM): you must remain in your cell (${assignedCell ?? "your cell"}) in silence until lights on at 6:00 PM. If the guards have locked your cell door it physically stops you; if they have not, leaving is still a violation they can punish.`;
      break;
  }

  return `[Schedule Status] ${line}`;
}
