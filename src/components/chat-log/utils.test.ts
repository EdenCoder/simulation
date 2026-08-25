import { describe, expect, it } from "vitest";

import type { ChatMessage } from "@/store/agents";
import type { ChatSession } from "@/store/chats";

import {
  formatCScoreDelta,
  formatSimClock,
  lastActivity,
  messageRecipientIds,
  selectLogSessions,
} from "./utils";

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "g1",
    name: "Guard #1",
    content: "Prisoner #1, report for work detail.",
    timestamp: 1000,
    ...overrides,
  };
}

function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: "chat_1",
    participants: ["g1", "p1"],
    messages: [],
    createdAt: 500,
    ...overrides,
  };
}

describe("lastActivity", () => {
  it("uses the newest message timestamp when there are messages", () => {
    const session = makeSession({
      messages: [
        makeMessage({ timestamp: 1000 }),
        makeMessage({ timestamp: 2500 }),
      ],
    });
    expect(lastActivity(session)).toBe(2500);
  });

  it("falls back to creation time for an empty session", () => {
    expect(lastActivity(makeSession({ createdAt: 700 }))).toBe(700);
  });
});

describe("selectLogSessions", () => {
  it("orders active sessions by most recent activity first", () => {
    const stale = makeSession({
      id: "stale",
      messages: [makeMessage({ timestamp: 1000 })],
    });
    const fresh = makeSession({
      id: "fresh",
      messages: [makeMessage({ timestamp: 9000 })],
    });

    const shown = selectLogSessions([stale, fresh], []);
    expect(shown.map((s) => s.session.id)).toEqual(["fresh", "stale"]);
    expect(shown.every((s) => !s.ended)).toBe(true);
  });

  it("fills remaining slots with recent ended sessions, marked as ended", () => {
    const active = makeSession({ id: "active" });
    const ended = makeSession({
      id: "ended",
      messages: [makeMessage({ timestamp: 100 })],
    });

    const shown = selectLogSessions([active], [ended], 5);
    expect(shown.map((s) => s.session.id)).toEqual(["active", "ended"]);
    expect(shown[1].ended).toBe(true);
  });

  it("hides ended sessions where nothing was said", () => {
    const silent = makeSession({ id: "silent", messages: [] });
    expect(selectLogSessions([], [silent])).toEqual([]);
  });

  it("caps ended sessions at the limit but always keeps every active one", () => {
    const active = [1, 2, 3].map((n) =>
      makeSession({ id: `a${n}`, messages: [makeMessage({ timestamp: n })] }),
    );
    const ended = [1, 2, 3].map((n) =>
      makeSession({ id: `e${n}`, messages: [makeMessage({ timestamp: n })] }),
    );

    const shown = selectLogSessions(active, ended, 2);
    expect(shown.filter((s) => !s.ended)).toHaveLength(3);
    expect(shown.filter((s) => s.ended)).toHaveLength(0);

    const withRoom = selectLogSessions(active, ended, 4);
    expect(withRoom.filter((s) => s.ended)).toHaveLength(1);
    expect(withRoom.filter((s) => s.ended)[0].session.id).toBe("e3");
  });
});

describe("messageRecipientIds", () => {
  it("prefers the send-time recipients snapshot", () => {
    const session = makeSession({ participants: ["g1", "p1", "p2"] });
    const msg = makeMessage({ recipients: ["p1"] });
    expect(messageRecipientIds(msg, session)).toEqual(["p1"]);
  });

  it("falls back to the session roster minus the sender", () => {
    const session = makeSession({ participants: ["g1", "p1", "p2"] });
    const msg = makeMessage({ id: "g1", recipients: undefined });
    expect(messageRecipientIds(msg, session)).toEqual(["p1", "p2"]);
  });
});

describe("formatSimClock", () => {
  it("formats afternoon and midnight times as 12-hour clock", () => {
    expect(formatSimClock(new Date(2026, 0, 1, 18, 5))).toBe("6:05 PM");
    expect(formatSimClock(new Date(2026, 0, 1, 0, 7))).toBe("12:07 AM");
    expect(formatSimClock(new Date(2026, 0, 1, 12, 0))).toBe("12:00 PM");
  });
});

describe("formatCScoreDelta", () => {
  it("signs positive deltas and passes negatives through", () => {
    expect(formatCScoreDelta(1)).toBe("+1");
    expect(formatCScoreDelta(-2)).toBe("-2");
  });
});
