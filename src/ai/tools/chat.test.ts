import { describe, expect, it, vi } from "vitest";

import { createChatTools, type ChatDeps } from "@/ai/tools/chat";

type Participant = { id: string; name: string; role: string };
type Message = { id: string; name: string; content: string; timestamp: number };

/**
 * Build a minimal in-memory ChatDeps for a guard ("g1") sitting in a chat
 * with the given prisoners. Tracks applied C-Score deltas per prisoner and
 * the messages sent so tests can assert on routing and nudges.
 */
function makeDeps(
  participants: Participant[],
  overrides: Partial<ChatDeps> = {},
) {
  const applied: Array<{ id: string; delta: number }> = [];
  const messages: Message[] = [];
  const totals = new Map<string, number>();

  const deps: ChatDeps = {
    agentId: "g1",
    agentName: "Guard #1",
    getCurrentChatId: () => "chat1",
    getNearbyAgents: () => [],
    createChat: () => ({ success: true, outcome: "" }),
    joinChat: () => ({ success: true, outcome: "" }),
    leaveChat: () => ({ success: true, outcome: "" }),
    sendMessage: vi.fn((_chatId, msg) => {
      messages.push(msg);
      return { success: true, outcome: "Message sent." };
    }),
    getMessages: () => messages,
    canAdjustCScore: true,
    getChatParticipants: () => participants,
    adjustCScore: (id, delta) => {
      applied.push({ id, delta });
      const total = (totals.get(id) ?? 0) + delta;
      totals.set(id, total);
      return total;
    },
    ...overrides,
  };

  return { deps, applied, messages };
}

const GUARD: Participant = { id: "g1", name: "Guard #1", role: "guard" };
const P1: Participant = { id: "p1", name: "Prisoner #1", role: "prisoner" };
const P2: Participant = { id: "p2", name: "Prisoner #2", role: "prisoner" };

describe("say cscore routing", () => {
  it("applies cscore to the only prisoner in a 1:1 chat", async () => {
    const { deps, applied } = makeDeps([GUARD, P1]);
    const { say } = createChatTools(deps);

    await say.execute({ message: "Good work.", cscore: 1 }, {} as any);

    expect(applied).toEqual([{ id: "p1", delta: 1 }]);
  });

  it("defaults to the prisoner who most recently spoke, not everyone", async () => {
    const { deps, applied } = makeDeps([GUARD, P1, P2]);
    const { say } = createChatTools(deps);

    // P2 speaks last before the guard responds.
    deps.sendMessage("chat1", {
      id: "p1",
      name: "Prisoner #1",
      content: "hi",
      timestamp: 1,
    });
    deps.sendMessage("chat1", {
      id: "p2",
      name: "Prisoner #2",
      content: "what about me, officer?",
      timestamp: 2,
    });

    await say.execute(
      { message: "Watch your tone. -1.", cscore: -1 },
      {} as any,
    );

    expect(applied).toEqual([{ id: "p2", delta: -1 }]);
  });

  it("honors an explicit cscore_target in a multi-prisoner chat", async () => {
    const { deps, applied } = makeDeps([GUARD, P1, P2]);
    const { say } = createChatTools(deps);

    await say.execute(
      { message: "Prisoner #1, -1.", cscore: -1, cscore_target: "Prisoner #1" },
      {} as any,
    );

    expect(applied).toEqual([{ id: "p1", delta: -1 }]);
  });

  it("does not match a substring target across similar names", async () => {
    const P11: Participant = {
      id: "p11",
      name: "Prisoner #11",
      role: "prisoner",
    };
    const { deps, applied } = makeDeps([GUARD, P1, P11]);
    const { say } = createChatTools(deps);

    await say.execute(
      { message: "Prisoner #1, -1.", cscore: -1, cscore_target: "Prisoner #1" },
      {} as any,
    );

    expect(applied).toEqual([{ id: "p1", delta: -1 }]);
  });
    it("refuses to apply cscore when the named target is not in the chat", async () => {
    const { deps, applied, messages } = makeDeps([GUARD, P1]);
    const { say } = createChatTools(deps);

    const res = await say.execute(
      { message: "Prisoner #4, -1.", cscore: -1, cscore_target: "Prisoner #4" },
      {} as any,
    );

    expect(res.success).toBe(false);
    expect(applied).toEqual([]);
    expect(messages).toEqual([]);
    expect(res.outcome).toContain("Prisoner #4 is not in this conversation");
  });

  it("applies the cscore before the message is sent", async () => {
    const order: string[] = [];
    const { deps } = makeDeps([GUARD, P1], {
      sendMessage: vi.fn(() => {
        order.push("send");
        return { success: true, outcome: "Message sent." };
      }),
    });
    const inner = deps.adjustCScore!;
    deps.adjustCScore = (id, delta) => {
      order.push("adjust");
      return inner(id, delta);
    };
    const { say } = createChatTools(deps);

    await say.execute({ message: "Good work.", cscore: 1 }, {} as any);

    expect(order).toEqual(["adjust", "send"]);
  });

  it("rolls back the cscore when the message fails to send", async () => {
    const { deps, applied } = makeDeps([GUARD, P1], {
      sendMessage: vi.fn(() => ({ success: false, outcome: "Blocked." })),
    });
    const { say } = createChatTools(deps);

    const res = await say.execute(
      { message: "Good work.", cscore: 1 },
      {} as any,
    );

    expect(res.success).toBe(false);
    expect(applied).toEqual([
      { id: "p1", delta: 1 },
      { id: "p1", delta: -1 },
    ]);
  });
});

describe("say cscore nudge", () => {
  it("nudges when a guard narrates a punishment but omits cscore", async () => {
    const { deps, applied } = makeDeps([GUARD, P1]);
    const { say } = createChatTools(deps);

    const res = await say.execute(
      { message: "I am deducting a point for that." },
      {} as any,
    );

    expect(applied).toEqual([]);
    expect(res.outcome).toContain("did not set the `cscore` parameter");
  });

  it("nudges when cscore is explicitly 0", async () => {
    const { deps } = makeDeps([GUARD, P1]);
    const { say } = createChatTools(deps);

    const res = await say.execute(
      { message: "That earns you a reward.", cscore: 0 },
      {} as any,
    );

    expect(res.outcome).toContain("Are you sure");
  });

  it("does not nudge an ordinary message with no score language", async () => {
    const { deps } = makeDeps([GUARD, P1]);
    const { say } = createChatTools(deps);

    const res = await say.execute(
      { message: "Move to your cell now." },
      {} as any,
    );

    expect(res.outcome).toBe("Message sent.");
  });

  it("does not nudge prisoners (only guards can adjust C-Score)", async () => {
    const { deps } = makeDeps([GUARD, P1], { canAdjustCScore: false });
    const { say } = createChatTools(deps);

    const res = await say.execute(
      { message: "He said he'd deduct a point." },
      {} as any,
    );

    expect(res.outcome).toBe("Message sent.");
  });
});
