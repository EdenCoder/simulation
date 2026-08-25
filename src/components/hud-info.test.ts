import { describe, expect, it } from "vitest";

import type { ChatMessage } from "@/store/agents";
import type { ChatSession } from "@/store/chats";

import { latestDeduction, shortAgentLabel } from "./hud-info";

function msg(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: "g1",
    name: "Guard #1",
    content: "…",
    timestamp: 0,
    ...overrides,
  };
}

function session(id: string, messages: ChatMessage[]): ChatSession {
  return { id, participants: [], messages, createdAt: 0 };
}

describe("shortAgentLabel", () => {
  it("compresses names to a letter and number", () => {
    expect(shortAgentLabel("Prisoner #3")).toBe("P3");
    expect(shortAgentLabel("Guard #12")).toBe("G12");
  });
});

describe("latestDeduction", () => {
  it("returns null for a guard who never deducted", () => {
    const s = session("a", [
      msg({ timestamp: 1, cScoreChange: { target: "Prisoner #1", delta: 2 } }),
    ]);
    expect(latestDeduction([s], "g1")).toBeNull();
  });

  it("finds the newest deduction across sessions and ignores rewards", () => {
    const older = session("a", [
      msg({
        timestamp: 10,
        cScoreChange: { target: "Prisoner #1", delta: -1 },
      }),
    ]);
    const newer = session("b", [
      msg({
        timestamp: 20,
        cScoreChange: { target: "Prisoner #4", delta: -2 },
      }),
      msg({ timestamp: 30, cScoreChange: { target: "Prisoner #5", delta: 1 } }),
    ]);

    expect(latestDeduction([older, newer], "g1")).toEqual({
      target: "Prisoner #4",
      delta: -2,
      timestamp: 20,
    });
  });

  it("only counts deductions made by the given guard", () => {
    const s = session("a", [
      msg({
        id: "g2",
        timestamp: 50,
        cScoreChange: { target: "Prisoner #2", delta: -3 },
      }),
      msg({
        timestamp: 10,
        cScoreChange: { target: "Prisoner #1", delta: -1 },
      }),
    ]);

    expect(latestDeduction([s], "g1")).toMatchObject({
      target: "Prisoner #1",
      delta: -1,
    });
  });
});
