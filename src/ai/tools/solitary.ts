/**
 * Log of solitary confinements.
 *
 * Confinement is administered by the guard team as a whole: any guard may
 * place or release a prisoner, every guard needs to know who is currently
 * in there, and the end-of-day report has to say who was confined, by
 * whom, for how long. None of that is recoverable from position data
 * alone, so it is recorded here when the escort actually succeeds.
 */

/** Simulation runs at 2x realtime; durations are reported in sim-minutes. */
const SIM_SPEED = 2;

export interface SolitaryRecord {
  prisonerName: string;
  confinedBy: string;
  confinedAt: number;
  releasedBy?: string;
  releasedAt?: number;
  confinementInferred?: boolean;
  releaseInferred?: boolean;
}

const log: SolitaryRecord[] = [];

/** Test-only: reset the log. */
export function clearSolitaryLog(): void {
  log.length = 0;
}

/** The open (unreleased) record for a prisoner, if any. */
export function getActiveConfinement(
  prisonerName: string,
): SolitaryRecord | undefined {
  return log.find((r) => r.prisonerName === prisonerName && !r.releasedAt);
}

/** Every confinement, oldest first — for the end-of-day report. */
export function getSolitaryHistory(): SolitaryRecord[] {
  return [...log];
}

/** Record that a guard placed a prisoner in Solitary. */
export function recordConfinement(
  prisonerName: string,
  guardName: string,
  now = Date.now(),
): void {
  const open = getActiveConfinement(prisonerName);
  if (open) {
    if (open.confinementInferred) {
      open.confinedBy = guardName;
      delete open.confinementInferred;
    }
    return;
  }
  log.push({ prisonerName, confinedBy: guardName, confinedAt: now });
}

/** Record that a guard released a prisoner. No-op if they were not confined. */
export function recordRelease(
  prisonerName: string,
  guardName: string,
  now = Date.now(),
): void {
  const open = getActiveConfinement(prisonerName);
  if (open) {
    open.releasedBy = guardName;
    open.releasedAt = now;
    return;
  }
  const inferred = [...log]
    .reverse()
    .find((r) => r.prisonerName === prisonerName && r.releaseInferred);
  if (inferred) {
    inferred.releasedBy = guardName;
    delete inferred.releaseInferred;
  }
}

/**
 * Reconcile the log against where prisoners actually are. The escort
 * callback only fires when forceMoveTo resolves true for both walkers, so
 * an interrupted escort leaves a confinement open after the prisoner has
 * physically left, or leaves an arrival unrecorded. Position is the
 * ground truth; entries closed or opened this way are marked inferred so
 * the export can tell them apart from a guard-reported one.
 */
export function reconcileConfinements(
  confinedNow: string[],
  now = Date.now(),
): void {
  const present = new Set(confinedNow);
  for (const r of log) {
    if (r.releasedAt || present.has(r.prisonerName)) continue;
    r.releasedAt = now;
    r.releaseInferred = true;
  }
  for (const name of present) {
    if (getActiveConfinement(name)) continue;
    log.push({
      prisonerName: name,
      confinedBy: "unrecorded",
      confinedAt: now,
      confinementInferred: true,
    });
  }
}

/** How long a confinement has run, in whole sim-minutes. */
export function confinementMinutes(
  r: SolitaryRecord,
  now = Date.now(),
): number {
  const end = r.releasedAt ?? now;
  return Math.max(0, Math.round(((end - r.confinedAt) * SIM_SPEED) / 60000));
}

/**
 * Guard-facing summary of who is currently confined. Shown to every guard
 * regardless of where they are standing.
 */
export function getSolitaryContext(now = Date.now()): string {
  const active = log.filter((r) => !r.releasedAt);
  if (active.length === 0) return "";
  const lines = active.map(
    (r) =>
      `- ${r.prisonerName}: confined by ${r.confinedBy}, ${confinementMinutes(r, now)} sim-minutes so far`,
  );
  return `[Solitary Confinement]\n${lines.join("\n")}\nThey cannot leave until a guard releases them with force_move_prisoner back to their cell. Do not look for them, order them anywhere, or punish them for not answering. Any guard may release them — decide whether the confinement should continue.`;
}
