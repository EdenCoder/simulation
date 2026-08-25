import { create } from "zustand";

import type { ChatMessage } from "./agents";
import { useAgentsStore } from "./agents";
import { getAgentWorldPosition } from "@/bridge";


/**
 * Max people in one conversation. Larger groups devolve into cross-talk
 * where messages stop landing on their addressee — guards end up
 * demanding answers from prisoners who have already left.
 */
export const MAX_CHAT_PARTICIPANTS = 3;

/** Recent messages per speaker, for repeat damping across chat sessions. */
const recentMessagesBySpeaker = new Map<
  string,
  Array<{ content: string; timestamp: number }>
>();
const SPEAKER_REPEAT_WINDOW_MS = 120_000;
const SPEAKER_REPEAT_HISTORY = 3;

/**
 * Echo damping: verbatim copies of a line said moments ago in the same
 * session are rejected. Short acknowledgments ("Yes, officer.") are exempt.
 */
const ECHO_WINDOW = 5;
const ECHO_MIN_LENGTH = 20;

/** Test-only: reset the cross-session repeat damping state. */
export function clearRepeatDamping(): void {
  recentMessagesBySpeaker.clear();
}

/** A chat session between two or more agents. */
export interface ChatSession {
  id: string;
  participants: string[];
  messages: ChatMessage[];
  createdAt: number;
}

interface ChatsStore {
  sessions: Record<string, ChatSession>;

  /** Archive of ended sessions so chat history is never lost. */
  endedSessions: Record<string, ChatSession>;

  /** Create a new chat session between participants. */
  createSession: (participantIds: string[]) => {
    success: boolean;
    chatId?: string;
    outcome: string;
  };

  /** Add an agent to an existing session. */
  joinSession: (
    chatId: string,
    agentId: string,
  ) => { success: boolean; outcome: string };

  /** Remove an agent from a session. Cleans up if <2 remain. */
  leaveSession: (
    chatId: string,
    agentId: string,
  ) => { success: boolean; outcome: string };

  /** Send a message in a chat session. */
  sendMessage: (
    chatId: string,
    message: ChatMessage,
  ) => { success: boolean; outcome: string };

  /** Get messages for a session. */
  getMessages: (chatId: string) => ChatMessage[];

  /** Get all sessions (active + ended) for complete chat history. */
  getAllSessions: () => ChatSession[];

  /** Get the chat session an agent is currently in, if any. */
  getAgentSession: (agentId: string) => ChatSession | undefined;

  /** Get nearby agents for a given agent. */
  getNearbyAgents: (
    agentId: string,
    maxDistance?: number,
  ) => Array<{ id: string; name: string; distance: number; inChat?: string }>;
}

function generateChatId(): string {
  return `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export const useChatsStore = create<ChatsStore>((set, get) => ({
  sessions: {},
  endedSessions: {},

  createSession: (participantIds) => {
    if (participantIds.length < 2) {
      return {
        success: false,
        outcome: "At least 2 participants are required.",
      };
    }
    if (participantIds.length > MAX_CHAT_PARTICIPANTS) {
      return {
        success: false,
        outcome: `A conversation can have at most ${MAX_CHAT_PARTICIPANTS} people.`,
      };
    }

    const agentsStore = useAgentsStore.getState();

    // Check if initiator is already in a chat — leave it first
    for (const pid of participantIds) {
      const existing = agentsStore.getAgent(pid)?.currentChatId;
      if (existing) {
        get().leaveSession(existing, pid);
      }
    }

    const chatId = generateChatId();
    const session: ChatSession = {
      id: chatId,
      participants: participantIds,
      messages: [],
      createdAt: Date.now(),
    };

    set((state) => ({ sessions: { ...state.sessions, [chatId]: session } }));

    for (const pid of participantIds) {
      agentsStore.updateChatId(pid, chatId);
    }

    const names = participantIds
      .map((id) => agentsStore.getAgent(id)?.name)
      .filter(Boolean)
      .join(", ");

    return { success: true, chatId, outcome: `Chat started with ${names}.` };
  },

  joinSession: (chatId, agentId) => {
    const session = get().sessions[chatId];
    if (!session)
      return { success: false, outcome: `Session ${chatId} not found.` };
    if (session.participants.includes(agentId)) {
      // Already in this chat — that's fine, treat as success
      useAgentsStore.getState().updateChatId(agentId, chatId);
      return { success: true, outcome: "Already in this chat." };
    }
    if (session.participants.length >= MAX_CHAT_PARTICIPANTS) {
      return {
        success: false,
        outcome: `That conversation is full (${MAX_CHAT_PARTICIPANTS} people max). Talk to someone else or do something different.`,
      };
    }

    // Leave any existing chat first
    const agentsStore = useAgentsStore.getState();
    const existing = agentsStore.getAgent(agentId)?.currentChatId;
    if (existing && existing !== chatId) {
      get().leaveSession(existing, agentId);
    }

    set((state) => ({
      sessions: {
        ...state.sessions,
        [chatId]: {
          ...session,
          participants: [...session.participants, agentId],
        },
      },
    }));

    agentsStore.updateChatId(agentId, chatId);
    return {
      success: true,
      outcome: `Joined chat. Participants: ${session.participants.length + 1}`,
    };
  },

  leaveSession: (chatId, agentId) => {
    const session = get().sessions[chatId];
    if (!session)
      return { success: false, outcome: `Session ${chatId} not found.` };
    if (!session.participants.includes(agentId))
      return { success: false, outcome: "Not in this chat." };

    const remaining = session.participants.filter((id) => id !== agentId);
    const agentsStore = useAgentsStore.getState();

    // Always clear this agent's chat state
    agentsStore.updateChatId(agentId, null);
    agentsStore.updateChatMessages(agentId, []);

    if (remaining.length <= 1) {
      // Archive the session so chat history is preserved for download
      for (const rid of remaining) {
        agentsStore.updateChatId(rid, null);
        agentsStore.updateChatMessages(rid, []);
      }
      set((state) => {
        const { [chatId]: ended, ...rest } = state.sessions;
        return {
          sessions: rest,
          endedSessions: { ...state.endedSessions, [chatId]: ended },
        };
      });
      return { success: true, outcome: "Left chat. Session ended." };
    }

    set((state) => ({
      sessions: {
        ...state.sessions,
        [chatId]: { ...session, participants: remaining },
      },
    }));

    return { success: true, outcome: "Left the chat." };
  },

  sendMessage: (chatId, message) => {
    const session = get().sessions[chatId];
    if (!session)
      return { success: false, outcome: `Session ${chatId} not found.` };
    if (!session.participants.includes(message.id)) {
      return {
        success: false,
        outcome: "Not in this chat. Use start_chat first.",
      };
    }

    // Loop damping: agents re-send the exact same line every tick, across
    // freshly created sessions, flooding the log. Reject verbatim repeats
    // of any of the speaker's recent lines within the damping window.
    const recent = recentMessagesBySpeaker.get(message.id) ?? [];
    const isOwnRepeat = recent.some(
      (r) =>
        r.content === message.content &&
        message.timestamp - r.timestamp < SPEAKER_REPEAT_WINDOW_MS,
    );
    if (isOwnRepeat) {
      return {
        success: false,
        outcome:
          "You already said exactly that recently. Do not repeat yourself — respond to what was said, rephrase, or take a different action.",
      };
    }

    // Echo damping: agents parrot a line another participant just said
    // ("It's a bit overwhelming..." repeated by three prisoners in a row).
    // Reject verbatim echoes of the session's recent messages; short
    // acknowledgments are allowed.
    if (message.content.length >= ECHO_MIN_LENGTH) {
      const echoed = session.messages
        .slice(-ECHO_WINDOW)
        .some((m) => m.content === message.content);
      if (echoed) {
        return {
          success: false,
          outcome:
            "That exact line was just said in this conversation. Do not echo it — say something new that responds to it.",
        };
      }
    }

    recent.push({ content: message.content, timestamp: message.timestamp });
    if (recent.length > SPEAKER_REPEAT_HISTORY) recent.shift();
    recentMessagesBySpeaker.set(message.id, recent);

    // The message carries its own C-Score change (set by the `say` tool), so
    // store it as-is, adding a snapshot of who was present to hear it.
    // Exports derive running totals from the C-Score deltas.
    const stored: ChatMessage = {
      ...message,
      recipients: session.participants.filter((pid) => pid !== message.id),
    };
    const updated: ChatSession = {
      ...session,
      messages: [...session.messages, stored],
    };
    set((state) => ({ sessions: { ...state.sessions, [chatId]: updated } }));

    // Update chat messages for all participants
    const agentsStore = useAgentsStore.getState();
    for (const pid of session.participants) {
      agentsStore.updateChatMessages(pid, [...updated.messages]);
    }

    // Show speech bubble on the speaker
    agentsStore.updateSpeechBubble(message.id, {
      content: message.content,
      timestamp: message.timestamp,
      duration: 5000,
    });

    return { success: true, outcome: `You said: "${message.content}"` };
  },

  getMessages: (chatId) => get().sessions[chatId]?.messages ?? [],

  getAllSessions: () => [
    ...Object.values(get().endedSessions),
    ...Object.values(get().sessions),
  ],

  getAgentSession: (agentId) => {
    return Object.values(get().sessions).find((s) =>
      s.participants.includes(agentId),
    );
  },

  getNearbyAgents: (agentId, maxDistance = 100) => {
    const agents = useAgentsStore.getState().getAllAgents();
    if (!agents.find((a) => a.id === agentId)) return [];

    // Use world-space coordinates from the Phaser bridge (not screen-space
    // from Zustand) so proximity is independent of camera zoom/pan.
    const myPos = getAgentWorldPosition(agentId);
    if (!myPos) return [];

    const sessions = get().sessions;

    return agents
      .filter((other) => other.id !== agentId)
      .map((other) => {
        const otherPos = getAgentWorldPosition(other.id);
        const distance = otherPos
          ? Math.sqrt(
              Math.pow(otherPos.x - myPos.x, 2) +
                Math.pow(otherPos.y - myPos.y, 2),
            )
          : Infinity;
        const chat = Object.values(sessions).find((s) =>
          s.participants.includes(other.id),
        );
        return { id: other.id, name: other.name, distance, inChat: chat?.id };
      })
      .filter((o) => o.distance < maxDistance)
      .sort((a, b) => a.distance - b.distance);
  },
}));
