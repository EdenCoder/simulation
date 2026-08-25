import type { ChatMessage } from "@/store/agents";
import type { ChatSession } from "@/store/chats";

/**
 * Pure selection/formatting logic for the conversation log panel, kept
 * out of the React component so it can be unit tested.
 */

export interface LogSession {
  session: ChatSession;
  ended: boolean;
}

/** When a session was last active: its newest message, or its creation. */
export function lastActivity(session: ChatSession): number {
  const last = session.messages[session.messages.length - 1];
  return last ? last.timestamp : session.createdAt;
}

/**
 * Pick which sessions the log shows: every active session (newest activity
 * first), then the most recent ended sessions that actually had messages,
 * up to `limit` total. Every active session is always kept, even past the
 * limit — hiding a live conversation would defeat the panel's purpose.
 */
export function selectLogSessions(
  active: ChatSession[],
  ended: ChatSession[],
  limit = 5,
): LogSession[] {
  const activeSorted = [...active]
    .sort((a, b) => lastActivity(b) - lastActivity(a))
    .map((session) => ({ session, ended: false }));

  const endedSorted = [...ended]
    .filter((s) => s.messages.length > 0)
    .sort((a, b) => lastActivity(b) - lastActivity(a))
    .map((session) => ({ session, ended: true }));

  const endedSlots = Math.max(0, limit - activeSorted.length);
  return [...activeSorted, ...endedSorted.slice(0, endedSlots)];
}

/**
 * Who heard this message: the send-time snapshot when available (the
 * session's final roster misrepresents who was actually present).
 */
export function messageRecipientIds(
  msg: ChatMessage,
  session: ChatSession,
): string[] {
  return msg.recipients ?? session.participants.filter((pid) => pid !== msg.id);
}

/** "8:42 PM" on the simulation clock. */
export function formatSimClock(time: Date): string {
  const hours = time.getHours();
  const minutes = time.getMinutes().toString().padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  const h12 = hours % 12 || 12;
  return `${h12}:${minutes} ${ampm}`;
}

/** Signed delta for a C-Score badge: "+1" / "-2". */
export function formatCScoreDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : `${delta}`;
}
