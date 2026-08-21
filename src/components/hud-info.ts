import type { ChatSession } from "@/store/chats";

/**
 * Pure helpers for the HUD avatar strip, kept out of the component so they
 * can be unit tested.
 */

export interface DeductionInfo {
  /** Prisoner name the deduction landed on (e.g. "Prisoner #3"). */
  target: string;
  /** Negative delta that was applied. */
  delta: number;
  timestamp: number;
}

/** Short identifying code: "Prisoner #3" → "P3", "Guard #1" → "G1". */
export function shortAgentLabel(name: string): string {
  const num = name.replace(/\D/g, "");
  const letter = name.trim().charAt(0).toUpperCase();
  return `${letter}${num}`;
}

/**
 * The most recent C-Score deduction a guard applied, across every chat
 * session (active and ended), or null if they have never deducted.
 * Rewards (positive deltas) are ignored.
 */
export function latestDeduction(
  sessions: ChatSession[],
  guardId: string,
): DeductionInfo | null {
  let latest: DeductionInfo | null = null;
  for (const session of sessions) {
    for (const msg of session.messages) {
      if (msg.id !== guardId) continue;
      const change = msg.cScoreChange;
      if (!change || change.delta >= 0) continue;
      if (!latest || msg.timestamp > latest.timestamp) {
        latest = {
          target: change.target,
          delta: change.delta,
          timestamp: msg.timestamp,
        };
      }
    }
  }
  return latest;
}
