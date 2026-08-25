/**
 * Per-agent chat cooldown. Applied after an agent is force-removed from a
 * conversation for overstaying (MAX_CHAT_TICKS), so they spend some ticks
 * moving and acting instead of immediately re-entering another chat. This
 * breaks the "everyone stands in the Common Area chatting forever" loop.
 *
 * Cooldowns only gate STARTING or JOINING a chat — a cooled-down agent can
 * still be pulled into a conversation someone else starts with them.
 */

const cooldownUntil = new Map<string, number>();

export function setChatCooldown(
  agentId: string,
  durationMs: number,
  now: number = Date.now(),
): void {
  cooldownUntil.set(agentId, now + durationMs);
}

/** Milliseconds of cooldown remaining (0 when none). */
export function getChatCooldownRemaining(
  agentId: string,
  now: number = Date.now(),
): number {
  return Math.max(0, (cooldownUntil.get(agentId) ?? 0) - now);
}

/** Test-only: reset all cooldowns. */
export function clearChatCooldowns(): void {
  cooldownUntil.clear();
}
