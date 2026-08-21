import { describe, expect, it, vi } from "vitest";

import { type ChatDeps, createChatTools } from "@/ai/tools/chat";

type Participant = { id: string; name: string; role: string };
type Message = {
  id: string;
  name: string;
  content: string;
  timestamp: number;
  cScoreChange?: { target: string; delta: number };
};

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

  it("targets the prisoner named in the message over the last speaker", async () => {
    const { deps, applied } = makeDeps([GUARD, P1, P2]);
    const { say } = createChatTools(deps);

    // P2 spoke last, but the guard's message addresses Prisoner #1.
    deps.sendMessage("chat1", {
      id: "p2",
      name: "Prisoner #2",
      content: "what about the schedule, officer?",
      timestamp: 1,
    });

    await say.execute(
      {
        message: "Prisoner #1, good work. +1.",
        cscore: 1,
      },
      {} as any,
    );

    expect(applied).toEqual([{ id: "p1", delta: 1 }]);
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

  it("records the applied change on the message that caused it", async () => {
    const { deps, messages } = makeDeps([GUARD, P1]);
    const { say } = createChatTools(deps);

    await say.execute({ message: "Watch it. -1.", cscore: -1 }, {} as any);

    expect(messages).toHaveLength(1);
    expect(messages[0].cScoreChange).toEqual({
      target: "Prisoner #1",
      delta: -1,
    });
  });

  it("leaves an ordinary message with no change to record", async () => {
    const { deps, messages } = makeDeps([GUARD, P1]);
    const { say } = createChatTools(deps);

    await say.execute({ message: "Move to your cell now." }, {} as any);

    expect(messages).toHaveLength(1);
    expect(messages[0].cScoreChange).toBeUndefined();
  });

  it("refuses to apply when prisoners are present but none has spoken", async () => {
    const { deps, applied, messages } = makeDeps([GUARD, P1, P2]);
    const { say } = createChatTools(deps);

    const res = await say.execute(
      { message: "One of you loses a point.", cscore: -1 },
      {} as any,
    );

    expect(res.success).toBe(false);
    expect(applied).toEqual([]);
    expect(messages).toEqual([]);
    expect(res.outcome).toContain(
      "ambiguous who the C-Score change applies to",
    );
  });

  it("refuses a vague target that matches multiple prisoners", async () => {
    const P12: Participant = {
      id: "p12",
      name: "Prisoner #12",
      role: "prisoner",
    };
    const { deps, applied, messages } = makeDeps([GUARD, P1, P12]);
    const { say } = createChatTools(deps);

    // "Prisoner #" has no exact match but is a substring of both names.
    const res = await say.execute(
      { message: "Point off.", cscore: -1, cscore_target: "Prisoner #" },
      {} as any,
    );

    expect(res.success).toBe(false);
    expect(applied).toEqual([]);
    expect(messages).toEqual([]);
    expect(res.outcome).toContain("matches multiple prisoners");
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

  it("holds a deduction for silence until the prisoner has had a turn", async () => {
    const { deps, applied, messages } = makeDeps([GUARD, P1]);
    const { say } = createChatTools(deps);

    // Guard asked something a moment ago; the prisoner has not replied yet.
    deps.sendMessage("chat1", {
      id: "g1",
      name: "Guard #1",
      content: "Prisoner #1, answer me.",
      timestamp: Date.now(),
    });

    const res = await say.execute(
      { message: "Prisoner #1, your silence is a violation. -1.", cscore: -1 },
      {} as any,
    );

    expect(applied).toEqual([]); // point held, not applied
    expect(res.outcome).toContain("has not had a chance to reply");
    expect(messages).toHaveLength(2); // the message still went out
  });

  it("applies a deduction once the prisoner has spoken since being addressed", async () => {
    const { deps, applied } = makeDeps([GUARD, P1]);
    const { say } = createChatTools(deps);

    deps.sendMessage("chat1", {
      id: "g1",
      name: "Guard #1",
      content: "Prisoner #1, report.",
      timestamp: Date.now() - 2000,
    });
    deps.sendMessage("chat1", {
      id: "p1",
      name: "Prisoner #1",
      content: "No, officer.",
      timestamp: Date.now(),
    });

    const res = await say.execute(
      { message: "Prisoner #1, that is disrespectful. -1.", cscore: -1 },
      {} as any,
    );

    expect(res.success).toBe(true);
    expect(applied).toEqual([{ id: "p1", delta: -1 }]);
  });
});

describe("say absent addressee warning", () => {
  it("warns when the message names someone not in the chat", async () => {
    const { deps } = makeDeps([GUARD, P1]);
    const { say } = createChatTools(deps);

    const res = await say.execute(
      { message: "Prisoner #6, answer me when I speak to you." },
      {} as any,
    );

    expect(res.success).toBe(true); // message still goes out
    expect(res.outcome).toContain("Prisoner #6 is not in this conversation");
    expect(res.outcome).toContain("cannot hear you");
  });

  it("does not warn when everyone named is present", async () => {
    const { deps } = makeDeps([GUARD, P1]);
    const { say } = createChatTools(deps);

    const res = await say.execute(
      { message: "Prisoner #1, keep your voice down." },
      {} as any,
    );

    expect(res.outcome).toBe("Message sent.");
  });

  it("lists every absent person named in the message", async () => {
    const { deps } = makeDeps([GUARD, P1]);
    const { say } = createChatTools(deps);

    const res = await say.execute(
      { message: "Prisoner #3, Prisoner #4, keep the noise down." },
      {} as any,
    );

    expect(res.outcome).toContain("Prisoner #3 and Prisoner #4");
  });
});

describe("start_chat cooldown", () => {
  it("blocks starting a chat while on a cooldown break", async () => {
    const { deps } = makeDeps([], {
      getCurrentChatId: () => null,
      getChatCooldownMs: () => 30_000,
      getNearbyAgents: () => [{ id: "p1", name: "Prisoner #1", distance: 10 }],
    });
    const { start_chat } = createChatTools(deps);

    const res = await start_chat.execute(
      { target_name: "Prisoner #1", message: "Hello." },
      {} as any,
    );

    expect(res.success).toBe(false);
    expect(res.outcome).toContain("break from conversation");
  });

  it("allows starting a chat once the cooldown has expired", async () => {
    const { deps } = makeDeps([], {
      getCurrentChatId: () => null,
      getChatCooldownMs: () => 0,
      getNearbyAgents: () => [{ id: "p1", name: "Prisoner #1", distance: 10 }],
      createChat: () => ({
        success: true,
        chatId: "c1",
        outcome: "Chat started.",
      }),
    });
    const { start_chat } = createChatTools(deps);

    const res = await start_chat.execute(
      { target_name: "Prisoner #1", message: "Hello." },
      {} as any,
    );

    expect(res.success).toBe(true);
  });
});

describe("start_chat opening message", () => {
  function makeStartDeps(overrides: Partial<ChatDeps> = {}) {
    return makeDeps([], {
      getCurrentChatId: () => null,
      getNearbyAgents: () => [{ id: "p1", name: "Prisoner #1", distance: 10 }],
      createChat: () => ({
        success: true,
        chatId: "c1",
        outcome: "Chat started with Prisoner #1.",
      }),
      ...overrides,
    });
  }

  it("creates the chat and sends the opening line in one step", async () => {
    const { deps, messages } = makeStartDeps();
    const { start_chat } = createChatTools(deps);

    const res = await start_chat.execute(
      { target_name: "Prisoner #1", message: "Prisoner #1, step forward." },
      {} as any,
    );

    expect(res.success).toBe(true);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("Prisoner #1, step forward.");
    expect(res.outcome).toContain("Wait for a reply");
  });

  it("dissolves a just-created chat when the opening line is rejected", async () => {
    const leaveChat = vi.fn(() => ({ success: true, outcome: "Left." }));
    const { deps } = makeStartDeps({
      sendMessage: () => ({
        success: false,
        outcome: "You already said exactly that recently.",
      }),
      leaveChat,
    });
    const { start_chat } = createChatTools(deps);

    const res = await start_chat.execute(
      { target_name: "Prisoner #1", message: "Prisoner #1, step forward." },
      {} as any,
    );

    expect(res.success).toBe(false);
    expect(res.outcome).toContain("was not started");
    expect(leaveChat).toHaveBeenCalledWith("c1");
  });

  it("joins the target's existing chat and speaks there", async () => {
    const joinChat = vi.fn(() => ({ success: true, outcome: "Joined chat." }));
    const { deps, messages } = makeStartDeps({
      getNearbyAgents: () => [
        { id: "p1", name: "Prisoner #1", distance: 10, inChat: "c9" },
      ],
      joinChat,
    });
    const { start_chat } = createChatTools(deps);

    const res = await start_chat.execute(
      { target_name: "Prisoner #1", message: "Prisoner #1, quiet down." },
      {} as any,
    );

    expect(res.success).toBe(true);
    expect(joinChat).toHaveBeenCalledWith("c9");
    expect(messages).toHaveLength(1);
  });

  it("stays in a joined chat even when the opening line is rejected", async () => {
    const leaveChat = vi.fn(() => ({ success: true, outcome: "Left." }));
    const { deps } = makeStartDeps({
      getNearbyAgents: () => [
        { id: "p1", name: "Prisoner #1", distance: 10, inChat: "c9" },
      ],
      joinChat: () => ({ success: true, outcome: "Joined chat." }),
      sendMessage: () => ({
        success: false,
        outcome: "That exact line was just said in this conversation.",
      }),
      leaveChat,
    });
    const { start_chat } = createChatTools(deps);

    const res = await start_chat.execute(
      { target_name: "Prisoner #1", message: "Prisoner #1, quiet down." },
      {} as any,
    );

    expect(res.success).toBe(false);
    expect(res.outcome).toContain("joined the conversation");
    expect(leaveChat).not.toHaveBeenCalled();
  });

  it("blocks leaving in the same turn as the opening line", async () => {
    const { deps } = makeStartDeps();
    const { start_chat, leave_chat } = createChatTools(deps);

    await start_chat.execute(
      { target_name: "Prisoner #1", message: "Prisoner #1, step forward." },
      {} as any,
    );
    const res = await leave_chat.execute({}, {} as any);

    expect(res.success).toBe(false);
    expect(res.outcome).toContain("Wait for a reply");
  });

  it("does not send the message when already in another conversation", async () => {
    const { deps, messages } = makeStartDeps({
      getCurrentChatId: () => "existing",
      getChatParticipants: () => [
        { id: "g1", name: "Guard #1", role: "guard" },
        { id: "p2", name: "Prisoner #2", role: "prisoner" },
      ],
    });
    const { start_chat } = createChatTools(deps);

    const res = await start_chat.execute(
      { target_name: "Prisoner #1", message: "Prisoner #1, come here." },
      {} as any,
    );

    expect(res.success).toBe(true);
    expect(res.outcome).toContain("NOT sent");
    expect(messages).toHaveLength(0);
  });
});

describe("leave_chat timing", () => {
  it("refuses to leave in the same turn as speaking", async () => {
    const { deps } = makeDeps([GUARD, P1]);
    const { say, leave_chat } = createChatTools(deps);

    await say.execute({ message: "Prisoner #1, hello." }, {} as any);
    const res = await leave_chat.execute({}, {} as any);

    expect(res.success).toBe(false);
    expect(res.outcome).toContain("Wait for a reply");
  });

  it("allows leaving on a turn with no speaking", async () => {
    const { deps } = makeDeps([GUARD, P1]);
    const { leave_chat } = createChatTools(deps);

    const res = await leave_chat.execute({}, {} as any);

    expect(res.success).toBe(true);
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

describe("location interrogation refusal", () => {
  it("lets a guard ask where an unseen prisoner is", async () => {
    const { deps, messages } = makeDeps([GUARD, P1], {
      getNearbyAgents: () => [{ id: "p1", name: "Prisoner #1", distance: 5 }],
      getKnownAgents: () => [GUARD, P1, P2],
      isGuard: true,
    });
    const { say } = createChatTools(deps);

    const res = await say.execute(
      { message: "Prisoner #1, where is Prisoner #2?" },
      {} as any,
    );

    expect(res.success).toBe(true);
    expect(messages).toHaveLength(1);
  });

  it("opens a session for a guard asking after an unseen prisoner", async () => {
    const createChat = vi.fn(() => ({
      success: true,
      chatId: "c1",
      outcome: "Chat started.",
    }));
    const { deps, messages } = makeDeps([], {
      getCurrentChatId: () => null,
      getNearbyAgents: () => [{ id: "p1", name: "Prisoner #1", distance: 10 }],
      createChat,
      isGuard: true,
    });
    const { start_chat } = createChatTools(deps);

    const res = await start_chat.execute(
      {
        target_name: "Prisoner #1",
        message: "Prisoner #1, where is Prisoner #3?",
      },
      {} as any,
    );

    expect(res.success).toBe(true);
    expect(createChat).toHaveBeenCalled();
    expect(messages).toHaveLength(1);
  });

  it("still lets a prisoner say they do not know where someone is", async () => {
    const { deps, messages } = makeDeps(
      [{ id: "p2", name: "Prisoner #2", role: "prisoner" }, GUARD],
      {
        agentId: "p2",
        agentName: "Prisoner #2",
        canAdjustCScore: false,
        isGuard: false,
        getNearbyAgents: () => [{ id: "g1", name: "Guard #1", distance: 5 }],
      },
    );
    const { say } = createChatTools(deps);

    const res = await say.execute(
      { message: "Officer, I don't know where Prisoner #1 is." },
      {} as any,
    );

    expect(res.success).toBe(true);
    expect(messages).toHaveLength(1);
  });
});

describe("say — region-aware visibility for location questions", () => {
  const G: Participant = { id: "g1", name: "Guard #1", role: "guard" };
  const P3: Participant = { id: "p3", name: "Prisoner #3", role: "prisoner" };

  // The proximity radius (100 units) is smaller than the larger regions, so
  // sharing a region must count as seeing someone. Otherwise a guard asks
  // where a prisoner standing across the same room is.
  it("refuses a location question about someone in the same region but out of radius", async () => {
    const { deps } = makeDeps([G, P1], {
      isGuard: true,
      getNearbyAgents: () => [], // nobody within the radius
      getKnownAgents: () => [{ id: "p3", name: "Prisoner #3" }],
      getRegionOf: () => "Common Area", // guard and #3 share the room
    });
    const { say } = createChatTools(deps);

    const res = await say.execute(
      { message: "Prisoner #1, where is Prisoner #3?" },
      {} as any,
    );

    expect(res.success).toBe(false);
    expect(res.outcome).toMatch(/already see Prisoner #3/i);
  });

  it("allows a location question about someone in a different region", async () => {
    const { deps } = makeDeps([G, P1], {
      isGuard: true,
      getNearbyAgents: () => [],
      getKnownAgents: () => [{ id: "p3", name: "Prisoner #3" }],
      getRegionOf: (id: string) => (id === "g1" ? "Common Area" : "Rec Room"),
    });
    const { say } = createChatTools(deps);

    const res = await say.execute(
      { message: "Prisoner #1, where is Prisoner #3?" },
      {} as any,
    );

    expect(res.success).toBe(true);
  });

  it("falls back to proximity when the region is unknown", async () => {
    const { deps } = makeDeps([G, P1], {
      isGuard: true,
      getNearbyAgents: () => [{ id: "p3", name: "Prisoner #3", distance: 20 }],
      getKnownAgents: () => [{ id: "p3", name: "Prisoner #3" }],
      getRegionOf: () => "unknown",
    });
    const { say } = createChatTools(deps);

    const res = await say.execute(
      { message: "Prisoner #1, where is Prisoner #3?" },
      {} as any,
    );

    expect(res.success).toBe(false);
    expect(res.outcome).toMatch(/already see/i);
  });
});

describe("say — work-detail task refusals", () => {
  const assigned = {
    prisonerName: "Prisoner #1",
    task: "clean the Common Area",
    assignedBy: "Guard #1",
    assignedAt: 0,
    status: "assigned" as const,
  };

  it("refuses a guard asking an unassigned prisoner what their task is", async () => {
    const { deps } = makeDeps([GUARD, P2], {
      isGuard: true,
      getPrisonerTask: () => undefined,
      isWorkDetail: () => true,
    });
    const { say } = createChatTools(deps);
    const res = await say.execute(
      { message: "Prisoner #2, what is your task?" },
      {} as any,
    );
    expect(res.success).toBe(false);
    expect(res.outcome).toMatch(/assign_task/i);
  });

  it("allows a guard to supervise a prisoner who already has a job", async () => {
    const { deps } = makeDeps([GUARD, P1], {
      isGuard: true,
      getPrisonerTask: () => assigned,
      isWorkDetail: () => true,
    });
    const { say } = createChatTools(deps);
    const res = await say.execute(
      { message: "Prisoner #1, I see you are cleaning the Common Area. Keep at it." },
      {} as any,
    );
    expect(res.success).toBe(true);
  });

  it("refuses a prisoner who already has a job asking what the task is", async () => {
    const P5: Participant = { id: "p5", name: "Prisoner #5", role: "prisoner" };
    const { deps } = makeDeps([P1, P5], {
      agentId: "p1",
      agentName: "Prisoner #1",
      isGuard: false,
      canAdjustCScore: false,
      getPrisonerTask: (name) => (name === "Prisoner #1" ? assigned : undefined),
      isWorkDetail: () => true,
    });
    const { say } = createChatTools(deps);
    const res = await say.execute(
      { message: "Prisoner #5, what is the task for tonight?" },
      {} as any,
    );
    expect(res.success).toBe(false);
    expect(res.outcome).toMatch(/already have a job/i);
  });
});
