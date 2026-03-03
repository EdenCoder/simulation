import { create } from 'zustand';

/** Bubble data for speech/thought/move displays. */
export interface BubbleData {
  content: string;
  timestamp: number;
  duration: number;
}

/** A single chat message between agents. */
export interface ChatMessage {
  id: string;
  name: string;
  content: string;
  timestamp: number;
  inflection?: string;
}

/** Runtime state for a single agent. */
export interface AgentState {
  id: string;
  name: string;
  role: string;
  characterType: 'arthur' | 'morgan';
  x: number;
  y: number;
  tint: number;
  speed: number;
  currentEmoji: string | null;
  speechBubble: BubbleData | null;
  thoughtBubble: BubbleData | null;
  moveBubble: (BubbleData & { isForced?: boolean }) | null;
  currentChatId: string | null;
  chatMessages: ChatMessage[];
  points: number;
}

interface AgentsStore {
  agents: Record<string, AgentState>;

  /** Initialize agents from scenario config. */
  initAgents: (agents: AgentState[]) => void;

  /** Get a single agent by ID. */
  getAgent: (id: string) => AgentState | undefined;

  /** Get all agents as an array. */
  getAllAgents: () => AgentState[];

  /** Update screen-space position (called every frame from Phaser). */
  updatePosition: (id: string, x: number, y: number) => void;

  /** Update the emoji displayed on the agent label. */
  updateEmoji: (id: string, emoji: string | null) => void;

  /** Update speech bubble (what the agent says aloud). */
  updateSpeechBubble: (id: string, bubble: BubbleData | null) => void;

  /** Update thought bubble (internal reasoning). */
  updateThoughtBubble: (id: string, bubble: BubbleData | null) => void;

  /** Update move bubble (movement indicator). */
  updateMoveBubble: (id: string, bubble: (BubbleData & { isForced?: boolean }) | null) => void;

  /** Update chat session ID. */
  updateChatId: (id: string, chatId: string | null) => void;

  /** Update chat messages for an agent. */
  updateChatMessages: (id: string, messages: ChatMessage[]) => void;

  /** Get points for a prisoner. */
  getPoints: (id: string) => number;

  /** Add points to a prisoner. */
  addPoints: (id: string, points: number) => void;

  /** Subtract points from a prisoner. */
  subtractPoints: (id: string, points: number) => void;

  /** Get all prisoner point totals. */
  getAllPrisonerPoints: () => Array<{ id: string; name: string; points: number }>;
}

export const useAgentsStore = create<AgentsStore>((set, get) => ({
  agents: {},

  initAgents: (agents) => {
    const record: Record<string, AgentState> = {};
    for (const agent of agents) {
      record[agent.id] = agent;
    }
    set({ agents: record });
  },

  getAgent: (id) => get().agents[id],

  getAllAgents: () => Object.values(get().agents),

  updatePosition: (id, x, y) =>
    set((state) => {
      const agent = state.agents[id];
      if (!agent) return state;
      return { agents: { ...state.agents, [id]: { ...agent, x, y } } };
    }),

  updateEmoji: (id, emoji) =>
    set((state) => {
      const agent = state.agents[id];
      if (!agent) return state;
      return { agents: { ...state.agents, [id]: { ...agent, currentEmoji: emoji } } };
    }),

  updateSpeechBubble: (id, bubble) =>
    set((state) => {
      const agent = state.agents[id];
      if (!agent) return state;
      return { agents: { ...state.agents, [id]: { ...agent, speechBubble: bubble } } };
    }),

  updateThoughtBubble: (id, bubble) =>
    set((state) => {
      const agent = state.agents[id];
      if (!agent) return state;
      return { agents: { ...state.agents, [id]: { ...agent, thoughtBubble: bubble } } };
    }),

  updateMoveBubble: (id, bubble) =>
    set((state) => {
      const agent = state.agents[id];
      if (!agent) return state;
      return { agents: { ...state.agents, [id]: { ...agent, moveBubble: bubble } } };
    }),

  updateChatId: (id, chatId) =>
    set((state) => {
      const agent = state.agents[id];
      if (!agent) return state;
      return { agents: { ...state.agents, [id]: { ...agent, currentChatId: chatId } } };
    }),

  updateChatMessages: (id, messages) =>
    set((state) => {
      const agent = state.agents[id];
      if (!agent) return state;
      return { agents: { ...state.agents, [id]: { ...agent, chatMessages: messages } } };
    }),

  getPoints: (id) => get().agents[id]?.points ?? 0,

  addPoints: (id, points) =>
    set((state) => {
      const agent = state.agents[id];
      if (!agent) return state;
      return { agents: { ...state.agents, [id]: { ...agent, points: agent.points + points } } };
    }),

  subtractPoints: (id, points) =>
    set((state) => {
      const agent = state.agents[id];
      if (!agent) return state;
      return {
        agents: {
          ...state.agents,
          [id]: { ...agent, points: Math.max(0, agent.points - points) },
        },
      };
    }),

  getAllPrisonerPoints: () =>
    Object.values(get().agents)
      .filter((a) => a.role === 'prisoner')
      .map((a) => ({ id: a.id, name: a.name, points: a.points })),
}));
