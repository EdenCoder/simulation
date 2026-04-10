import { create } from "zustand";

import type { ChatMessage } from "./agents";
import { useAgentsStore } from "./agents";

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

    // No speaking lock — multiple agents can send messages freely

    const updated: ChatSession = {
      ...session,
      messages: [...session.messages, message],
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
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) return [];

    const sessions = get().sessions;

    return agents
      .filter((other) => other.id !== agentId)
      .map((other) => {
        const distance = Math.sqrt(
          Math.pow(other.x - agent.x, 2) + Math.pow(other.y - agent.y, 2),
        );
        const chat = Object.values(sessions).find((s) =>
          s.participants.includes(other.id),
        );
        return { id: other.id, name: other.name, distance, inChat: chat?.id };
      })
      .filter((o) => o.distance < maxDistance)
      .sort((a, b) => a.distance - b.distance);
  },
}));
