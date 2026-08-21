import { beforeEach, describe, expect, it } from "vitest";

import { type AgentState, useAgentsStore } from "./agents";
import {
  clearRepeatDamping,
  MAX_CHAT_PARTICIPANTS,
  useChatsStore,
} from "./chats";

function makeAgent(id: string, name: string, role: string): AgentState {
  return {
    id,
    name,
    role,
    characterType: "arthur",
    x: 0,
    y: 0,
    tint: 0,
    speed: 45,
    currentEmoji: null,
    speechBubble: null,
    thoughtBubble: null,
    moveBubble: null,
    currentChatId: null,
    chatMessages: [],
    points: 0,
  };
}

function msg(id: string, name: string, content: string, timestamp: number) {
  return { id, name, content, timestamp };
}

beforeEach(() => {
  useAgentsStore
    .getState()
    .initAgents([
      makeAgent("p1", "Prisoner #1", "prisoner"),
      makeAgent("p2", "Prisoner #2", "prisoner"),
      makeAgent("p3", "Prisoner #3", "prisoner"),
      makeAgent("g1", "Guard #1", "guard"),
    ]);
  useChatsStore.setState({ sessions: {}, endedSessions: {} });
  clearRepeatDamping();
});

describe("chat participant cap", () => {
  it("rejects creating a session larger than the cap", () => {
    const res = useChatsStore
      .getState()
      .createSession(["p1", "p2", "p3", "g1"]);
    expect(res.success).toBe(false);
    expect(res.outcome).toContain(`${MAX_CHAT_PARTICIPANTS}`);
  });

  it("rejects joining a full session", () => {
    const store = useChatsStore.getState();
    const { chatId } = store.createSession(["p1", "p2"]);
    expect(store.joinSession(chatId!, "p3").success).toBe(true);
    const res = useChatsStore.getState().joinSession(chatId!, "g1");
    expect(res.success).toBe(false);
    expect(res.outcome).toContain("full");
  });
});

describe("repeat and echo damping", () => {
  it("rejects a speaker repeating their own line within the window", () => {
    const store = useChatsStore.getState();
    const { chatId } = store.createSession(["p1", "p2"]);

    const line = "Prisoner #2, do you know anything about the guards?";
    expect(
      store.sendMessage(chatId!, msg("p1", "Prisoner #1", line, 1000)).success,
    ).toBe(true);
    // 40s later — outside the old 30s window, still inside the new one.
    const res = store.sendMessage(
      chatId!,
      msg("p1", "Prisoner #1", line, 41_000),
    );
    expect(res.success).toBe(false);
    expect(res.outcome).toContain("Do not repeat yourself");
  });

  it("rejects repeating any of the speaker's recent lines, not just the last", () => {
    const store = useChatsStore.getState();
    const { chatId } = store.createSession(["p1", "p2"]);

    const demand = "Prisoner #2, answer me when I speak to you.";
    expect(
      store.sendMessage(chatId!, msg("p1", "Prisoner #1", demand, 1000))
        .success,
    ).toBe(true);
    expect(
      store.sendMessage(
        chatId!,
        msg("p1", "Prisoner #1", "Well? I am waiting.", 9000),
      ).success,
    ).toBe(true);
    const res = store.sendMessage(
      chatId!,
      msg("p1", "Prisoner #1", demand, 17_000),
    );
    expect(res.success).toBe(false);
  });

  it("rejects echoing another participant's recent line verbatim", () => {
    const store = useChatsStore.getState();
    const { chatId } = store.createSession(["p1", "p2"]);

    const line = "It's a bit overwhelming. Is it always like this?";
    expect(
      store.sendMessage(chatId!, msg("p1", "Prisoner #1", line, 1000)).success,
    ).toBe(true);
    const res = store.sendMessage(
      chatId!,
      msg("p2", "Prisoner #2", line, 5000),
    );
    expect(res.success).toBe(false);
    expect(res.outcome).toContain("Do not echo");
  });

  it("allows short acknowledgments to repeat across speakers", () => {
    const store = useChatsStore.getState();
    const { chatId } = store.createSession(["p1", "p2"]);

    expect(
      store.sendMessage(
        chatId!,
        msg("p1", "Prisoner #1", "Yes, officer.", 1000),
      ).success,
    ).toBe(true);
    expect(
      store.sendMessage(
        chatId!,
        msg("p2", "Prisoner #2", "Yes, officer.", 2000),
      ).success,
    ).toBe(true);
  });

  it("allows the same line again after the damping window has passed", () => {
    const store = useChatsStore.getState();
    const { chatId } = store.createSession(["p1", "p2"]);

    const line = "Good evening. How are you holding up in here?";
    expect(
      store.sendMessage(chatId!, msg("p1", "Prisoner #1", line, 1000)).success,
    ).toBe(true);
    // Push enough messages that the session echo window moves past it.
    for (let i = 0; i < 6; i++) {
      expect(
        store.sendMessage(
          chatId!,
          msg("p2", "Prisoner #2", `filler message number ${i}`, 2000 + i),
        ).success,
      ).toBe(true);
    }
    const res = store.sendMessage(
      chatId!,
      msg("p1", "Prisoner #1", line, 130_000),
    );
    expect(res.success).toBe(true);
  });
});

describe("recipient snapshots", () => {
  it("records who was present when each message was sent", () => {
    const store = useChatsStore.getState();
    const { chatId } = store.createSession(["p1", "p2"]);
    store.sendMessage(
      chatId!,
      msg("p1", "Prisoner #1", "Hello there, cellmate.", 1000),
    );

    useChatsStore.getState().joinSession(chatId!, "p3");
    useChatsStore
      .getState()
      .sendMessage(
        chatId!,
        msg("p2", "Prisoner #2", "Now there are three of us.", 2000),
      );

    const messages = useChatsStore.getState().getMessages(chatId!);
    expect(messages[0].recipients).toEqual(["p2"]);
    expect(messages[1].recipients).toEqual(["p1", "p3"]);
  });
});
