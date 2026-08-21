/**
 * Programmatic schedule enforcement for the prison scenario.
 *
 * Runs on a real-time interval (independent of agent LLM ticks) and
 * guarantees the protocol regardless of what the agents decide to do:
 *
 * - Lights out (11:00 PM): the three cell doors are locked.
 * - Lights on (6:00 PM): the cell doors are unlocked.
 *
 * Curfew is deliberately NOT enforced here. Returning stragglers to their
 * cells is the guards' job, using force_move_prisoner. Doing it
 * automatically would remove the prisoners' ability to disobey and the
 * guards' responsibility for noticing, both of which the experiment is
 * meant to measure.
 *
 * Locked doors never restrict guards: their pathfinding and the door
 * collider treat locked doors as openable (master key).
 */

import {
  CELL_DOOR_CORRIDOR,
  CELL_REGIONS,
  getSchedulePhase,
  type SchedulePhase,
} from "@/scenarios/prison/schedule";

import { getCurrentGameTime } from "./context/time";

export interface EnforcerBridge {
  escortAgentToRegion: (
    agentId: string,
    regionLabel: string,
  ) => Promise<boolean>;
  isAgentMoving: (agentId: string) => boolean;
  findDoorByRegions: (
    r1: string,
    r2: string,
  ) => {
    door: unknown;
    lock: (d: unknown) => boolean;
    unlock: (d: unknown) => boolean;
  } | null;
}

const ENFORCE_INTERVAL_MS = 5000; // 10 simulation-minutes at 2x realtime

let timer: ReturnType<typeof setInterval> | null = null;
let lastPhase: SchedulePhase | null = null;

function setCellDoorsLocked(bridge: EnforcerBridge, locked: boolean): void {
  for (const cell of CELL_REGIONS) {
    const found = bridge.findDoorByRegions(cell, CELL_DOOR_CORRIDOR);
    if (!found) {
      console.warn(
        `[Enforcer] No door found between ${cell} and ${CELL_DOOR_CORRIDOR}`,
      );
      continue;
    }
    if (locked) found.lock(found.door);
    else found.unlock(found.door);
  }
  console.log(
    `[Enforcer] Cell doors ${locked ? "LOCKED (lights out)" : "unlocked (lights on)"}`,
  );
}

/** Run one enforcement pass. Exported for tests. */
export function enforceScheduleOnce(bridge: EnforcerBridge): void {
  const now = getCurrentGameTime();
  if (!now) return;

  const phase = getSchedulePhase(now);
  if (phase !== lastPhase) {
    console.log(
      `[Enforcer] Schedule phase: ${lastPhase ?? "(start)"} -> ${phase}`,
    );
    if (phase === "lights_out") {
      setCellDoorsLocked(bridge, true);
    } else if (phase === "lights_on" && lastPhase !== null) {
      setCellDoorsLocked(bridge, false);
    }
    lastPhase = phase;
  }
}

/** Start the enforcement loop. Call once after the bridge is ready. */
export function startScheduleEnforcer(bridge: EnforcerBridge): void {
  if (timer) return;
  console.log("[Enforcer] Schedule enforcer started");
  timer = setInterval(() => enforceScheduleOnce(bridge), ENFORCE_INTERVAL_MS);
}

export function stopScheduleEnforcer(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  lastPhase = null;
}
