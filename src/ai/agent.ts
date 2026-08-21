/**
 * Core AI Agent Runner
 *
 * Each agent is a tool-loop agent: generateText with maxSteps allows the model
 * to call tools iteratively until it finishes or hits the step limit.
 * Every ~8 seconds, each agent gets a fresh tick with updated dynamic context.
 */

import { createOpenAI } from "@ai-sdk/openai";
import { type CoreMessage, generateText } from "ai";

import type { AgentConfig, RegionConfig } from "@/engine/types";
import { getGuardPrompt } from "@/scenarios/prison/prompts/guard";
import { getPrisonerPrompt } from "@/scenarios/prison/prompts/prisoner";
import {
  getAssignedCell,
  getScheduleContext,
  getSchedulePhase,
} from "@/scenarios/prison/schedule";
import { type ChatMessage, useAgentsStore } from "@/store/agents";
import { useChatsStore } from "@/store/chats";

import {
  acquireWarmupSlot,
  isBackendWarmedUp,
  markBackendWarmedUp,
  releaseWarmupSlot,
  resetBackendWarmup,
} from "./backend-warmup";
import { getChatCooldownRemaining, setChatCooldown } from "./chat-cooldown";
import { getNearbyContext } from "./context/nearby";
import { getCurrentGameTime, getTimeContext } from "./context/time";
import { isTimeoutError } from "./llm-errors";
import { scheduleAgentCall } from "./rate-limiter";
import { createChatTools } from "./tools/chat";
import { createDoorTools, getDoorContext } from "./tools/door";
import { createEmotionsTool, EmotionState } from "./tools/emotions";
import { createMemoryTool, MemoryStore } from "./tools/memory";
import { createMoveTools } from "./tools/move";
import { getPointsContext } from "./tools/points";
import {
  createRelationshipTools,
  RelationshipState,
} from "./tools/relationship";
import {
  getSolitaryContext,
  recordConfinement,
  recordRelease,
} from "./tools/solitary";
import {
  createTaskTools,
  getGuardTaskContext,
  getPrisonerTaskContext,
} from "./tools/tasks";

// --- Persistent message log entry (never trimmed) ---

interface MessageLogEntry {
  agentId: string;
  agentName: string;
  agentRole: string;
  currentRegion: string;
  role: string;
  content: string;
  timestamp: number;
}

/** Append-only log of all LLM messages across the simulation. Never trimmed. */
const messageLog: MessageLogEntry[] = [];

// --- Hourly C-score snapshots ---

interface CScoreSnapshot {
  simulationTime: string;
  realTimestamp: number;
  scores: Array<{ id: string; name: string; points: number; region: string }>;
}

const cScoreSnapshots: CScoreSnapshot[] = [];
let lastSnapshotHour: number | null = null;

/**
 * Check whether the simulation clock has crossed an hour boundary since
 * the last snapshot, and if so, record a C-score snapshot.
 */
function checkHourlyCScoreSnapshot(): void {
  const simTime = getCurrentGameTime();
  if (!simTime) return;

  const currentHour = simTime.getHours();
  if (lastSnapshotHour === null) {
    // First call — record the starting hour but don't snapshot yet
    lastSnapshotHour = currentHour;
    return;
  }

  if (currentHour === lastSnapshotHour) return;

  // Hour changed — take a snapshot
  lastSnapshotHour = currentHour;

  const agentsStore = useAgentsStore.getState();
  const prisoners = agentsStore
    .getAllAgents()
    .filter((a) => a.role === "prisoner");

  const hours = simTime.getHours();
  const minutes = simTime.getMinutes().toString().padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  const h12 = hours % 12 || 12;

  cScoreSnapshots.push({
    simulationTime: `${h12}:${minutes} ${ampm}`,
    realTimestamp: Date.now(),
    scores: prisoners.map((p) => ({
      id: p.id,
      name: p.name,
      points: p.points,
      region: getAgentRegion(p.id),
    })),
  });

  console.log(
    `[AI] C-Score snapshot at ${h12}:${minutes} ${ampm}:`,
    prisoners.map((p) => `${p.name}=${p.points}`).join(", "),
  );
}

// --- State per agent ---

interface AgentRuntime {
  config: AgentConfig;
  systemPrompt: string;
  messages: CoreMessage[];
  memoryStore: MemoryStore;
  relationshipState: RelationshipState;
  emotionState: EmotionState;
  running: boolean;
}

const agentRuntimes = new Map<string, AgentRuntime>();

/**
 * Track how many consecutive ticks each agent has spent in the same chat.
 * After MAX_CHAT_TICKS, the agent is auto-removed from the chat to prevent
 * the infinite chat loop where all agents gather and stop moving.
 */
const chatTickCounts = new Map<string, { chatId: string; ticks: number }>();
const MAX_CHAT_TICKS = 6;

/** Chat break after being force-removed from an overlong conversation. */
const CHAT_COOLDOWN_AFTER_TIMEOUT_MS = 45_000;

/**
 * Last time each agent started a movement. Agents that stand still too long
 * (outside a conversation) get a restlessness nudge in their context —
 * otherwise everyone congregates in one region and never moves.
 */
const lastMoveAt = new Map<string, number>();
const RESTLESS_AFTER_MS = 90_000;

/**
 * The initial user message every agent starts with. Also used as the
 * reset anchor if runtime.messages gets irrecoverably corrupted.
 */
const INITIAL_USER_MESSAGE =
  "The simulation has started. Look around, decide what to do, and take action using the tools available to you. You MUST use at least one tool (like move_to_region) on every turn.";

/**
 * Trim a message history without breaking tool-call / tool-result pairing.
 *
 * The OpenAI-compatible API requires every `tool` role message to be
 * preceded by an `assistant` message containing the matching tool_call_id.
 * A naive `slice(-N)` can cut between an assistant with tool_calls and
 * its tool results, leaving an orphan `tool` message at index 0 — which
 * causes every subsequent request to 400 permanently for that agent.
 *
 * This helper walks forward from the proposed cut point until it finds a
 * non-`tool` message, guaranteeing the kept window starts at a valid
 * boundary (user, system, or assistant).
 */
function safeTrimMessages(
  messages: CoreMessage[],
  keepLast: number,
): CoreMessage[] {
  if (messages.length <= keepLast) return messages;
  let cutIndex = messages.length - keepLast;
  while (cutIndex < messages.length && messages[cutIndex].role === "tool") {
    cutIndex++;
  }
  return messages.slice(cutIndex);
}

/**
 * Detect whether a message history is corrupted in a way that will cause
 * every subsequent API call to fail — specifically, starting with an
 * orphan `tool` message.
 */
function isMessageHistoryCorrupted(messages: CoreMessage[]): boolean {
  return messages.length > 0 && messages[0].role === "tool";
}

/**
 * Reasoning-model text-to-tool-call fallback.
 *
 * Qwen3.6 and other thinking models occasionally emit text like
 * `"say: Hello there."` instead of calling the `say` tool. If the agent
 * is in an active chat and no `say` tool was fired this tick, parse the
 * message out of the text and send it through the chat store directly.
 *
 * Returns the recovered message string on success, or null if nothing
 * was recovered.
 */
function recoverSayFromText(params: {
  agentId: string;
  agentName: string;
  text: string | undefined;
  toolCallsThisTick: Array<{ toolName: string }>;
}): string | null {
  const { agentId, agentName, text, toolCallsThisTick } = params;
  if (!text) return null;

  // If the model already called `say` this tick, don't double-send.
  if (toolCallsThisTick.some((tc) => tc.toolName === "say")) return null;

  const agent = useAgentsStore.getState().getAgent(agentId);
  if (!agent?.currentChatId) return null;

  // Match `say:` (case-insensitive), optionally wrapped in quotes, at the
  // start of the text or on its own line. Allow a leading newline from
  // the reasoning model's output conventions.
  const match = text.match(/(?:^|\n)\s*say\s*[:-]\s*["']?(.+?)["']?\s*$/is);
  if (!match) return null;

  const message = match[1].trim();
  if (!message) return null;

  const chatsStore = useChatsStore.getState();
  const sendResult = chatsStore.sendMessage(agent.currentChatId, {
    id: agentId,
    name: agentName,
    content: message,
    timestamp: Date.now(),
  });
  if (!sendResult.success) return null;

  // Notify chat partners to tick sooner, same as the real `say` tool.
  notifyChatPartners(agent.currentChatId, agentId);

  return message;
}

// --- Bridge functions (set by the Phaser engine) ---

export interface BridgeFunctions {
  moveTo: (agentId: string, x: number, y: number) => Promise<boolean>;
  forceMoveTo: (
    guardId: string,
    prisonerId: string,
    x: number,
    y: number,
  ) => Promise<boolean>;
  findDoorByRegions: (
    r1: string,
    r2: string,
  ) => {
    door: unknown;
    lock: (d: unknown) => boolean;
    unlock: (d: unknown) => boolean;
  } | null;
  getAllDoorStates: () => Array<{
    region1: string;
    region2: string;
    isLocked: boolean;
  }>;
  getRegions: () => RegionConfig[];
  getAgentWorldPosition: (agentId: string) => { x: number; y: number } | null;
  escortAgentToRegion: (
    agentId: string,
    regionLabel: string,
  ) => Promise<boolean>;
  isAgentMoving: (agentId: string) => boolean;
}

let bridgeFns: BridgeFunctions | null = null;

export function setBridgeFunctions(fns: BridgeFunctions) {
  bridgeFns = fns;
  console.log(
    "[AI] Bridge functions set. Regions available:",
    fns.getRegions().length,
  );
}

// --- LLM model (any OpenAI-compatible endpoint) ---

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL_ID = "openrouter/free";

const modelCache = new Map<
  string,
  ReturnType<ReturnType<typeof createOpenAI>>
>();

function getModel(role: string) {
  const modelId =
    role === "guard"
      ? import.meta.env.VITE_GUARD_MODEL || DEFAULT_MODEL_ID
      : import.meta.env.VITE_PRISONER_MODEL || DEFAULT_MODEL_ID;

  const cached = modelCache.get(modelId);
  if (cached) return cached;

  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY || "";
  const baseURL = import.meta.env.VITE_OPENAI_BASE_URL || DEFAULT_BASE_URL;
  if (!apiKey) {
    console.error(
      "[AI] VITE_OPENROUTER_API_KEY is not set! Agents will not work.",
    );
  }
  const provider = createOpenAI({
    baseURL,
    apiKey,
  });
  const model = provider(modelId);
  modelCache.set(modelId, model);
  return model;
}

// --- System prompt builder ---

function buildSystemPrompt(agentConfig: AgentConfig): string {
  const number = agentConfig.name.replace(/[^0-9]/g, "") || "1";

  if (agentConfig.role === "guard") {
    const prisoners = useAgentsStore
      .getState()
      .getAllAgents()
      .filter((a) => a.role === "prisoner")
      .map((p) => p.name.replace(/[^0-9]/g, ""))
      .filter(Boolean)
      .join(", ");
    return getGuardPrompt(number, prisoners || "1, 2, 3, 4, 5, 6");
  }

  return getPrisonerPrompt(number);
}

function buildDynamicContext(agentId: string, runtime: AgentRuntime): string {
  const sections: string[] = [];

  sections.push(getTimeContext());

  // Spatial awareness: every agent always knows exactly where they are.
  const myRegion = getAgentRegion(agentId);
  sections.push(
    `[Your Location] You are currently in: ${myRegion === "unknown" ? "an unmapped part of the prison" : myRegion}`,
  );

  // Schedule phase and what it currently permits/requires.
  const simTime = getCurrentGameTime();
  if (simTime) {
    sections.push(
      getScheduleContext(
        simTime,
        runtime.config.role,
        getAssignedCell(runtime.config.name),
      ),
    );
  }

  sections.push(getNearbyContext(agentId, getAgentRegion));

  // A guard sees only the prisoners they are near — they have to patrol to
  // find the rest. Listing every prisoner's position each turn would make
  // the guards omniscient and remove any need to search.
  //
  // Solitary is the exception. Confinement is a formal status the whole
  // guard team administers and must report on, so every guard knows who
  // is in there without having to walk to the cell. Without this a
  // confined prisoner looked simply missing, and guards spent the rest of
  // the run hunting for someone a colleague had just locked up.
  if (runtime.config.role === "guard") {
    const nearbyIds = new Set(
      useChatsStore
        .getState()
        .getNearbyAgents(agentId)
        .map((a) => a.id),
    );
    const prisoners = useAgentsStore
      .getState()
      .getAllAgents()
      .filter((a) => a.role === "prisoner");
    const inSolitary = prisoners.filter(
      (p) => getAgentRegion(p.id) === "Solitary",
    );
    const solitaryIds = new Set(inSolitary.map((p) => p.id));
    // Anyone sharing your region is in the same room, so you can see them
    // even when they are across it. Proximity alone is not enough: the
    // radius is smaller than the larger regions, so two agents standing at
    // opposite ends of the Common Area were invisible to each other while
    // holding a conversation — guards then demanded to know where someone
    // standing in front of them was.
    const visible = prisoners.filter(
      (p) =>
        !solitaryIds.has(p.id) &&
        (nearbyIds.has(p.id) || getAgentRegion(p.id) === myRegion),
    );
    const visibleIds = new Set(visible.map((p) => p.id));
    if (prisoners.length > 0) {
      const lines = visible.map((p) => {
        const region = getAgentRegion(p.id);
        const cell = getAssignedCell(p.name);
        return `- ${p.name}: ${region === "unknown" ? "location unclear" : region}${cell ? ` (assigned to ${cell})` : ""}`;
      });
      const unseen = prisoners
        .filter((p) => !visibleIds.has(p.id) && !solitaryIds.has(p.id))
        .map((p) => p.name);
      const body =
        lines.length > 0
          ? `You can see:\n${lines.join("\n")}\nDo not ask these prisoners where they are — you are looking at them.`
          : "- (none in sight)";
      const tail =
        unseen.length > 0
          ? `\nNot in sight: ${unseen.join(", ")}. You do not know where they are — ask someone, or patrol with move_to_region until they appear above.`
          : "";
      sections.push(`[Prisoners In Sight]\n${body}${tail}`);
    }
    // Who is confined, by whom, and for how long — known to every guard.
    const solitary = getSolitaryContext();
    if (solitary) sections.push(solitary);
    // Shared work-detail board. A prisoner's location is shown only when
    // this guard can actually see them, matching [Prisoners In Sight].
    sections.push(
      getGuardTaskContext((name) => {
        const p = prisoners.find((a) => a.name === name);
        if (!p || !nearbyIds.has(p.id)) return "unknown";
        return getAgentRegion(p.id);
      }),
    );
  } else {
    sections.push(getPrisonerTaskContext(runtime.config.name));
  }

  sections.push(runtime.memoryStore.getContext());
  sections.push(runtime.relationshipState.getContext());
  sections.push(runtime.emotionState.getContext());

  // Points context
  const agentsStore = useAgentsStore.getState();
  sections.push(
    getPointsContext({
      agentId,
      role: runtime.config.role,
      getPoints: (id) => useAgentsStore.getState().getPoints(id),
      getAllPrisonerPoints: () =>
        useAgentsStore.getState().getAllPrisonerPoints(),
    }),
  );

  // Door states
  if (bridgeFns) {
    sections.push(
      getDoorContext({ getAllDoorStates: bridgeFns.getAllDoorStates }),
    );
  }

  // Available regions (so the agent knows what move targets exist)
  // Filter out "Escape" — agents shouldn't navigate there directly
  if (bridgeFns) {
    const regions = bridgeFns.getRegions().filter((r) => r.label !== "Escape");
    if (regions.length > 0) {
      const regionNames = regions.map((r) => r.label).join(", ");
      sections.push(`[Available Regions] ${regionNames}`);
    }
  }

  // --- Chat timeout: force-leave if agent has been chatting too long ---
  const agent = agentsStore.getAgent(agentId);
  if (agent?.currentChatId) {
    const tracker = chatTickCounts.get(agentId);
    if (tracker && tracker.chatId === agent.currentChatId) {
      tracker.ticks++;
    } else {
      chatTickCounts.set(agentId, { chatId: agent.currentChatId, ticks: 1 });
    }
    const current = chatTickCounts.get(agentId)!;
    if (current.ticks >= MAX_CHAT_TICKS) {
      console.log(
        `[AI] ${agentId}: Auto-leaving chat ${agent.currentChatId} after ${current.ticks} ticks`,
      );
      useChatsStore.getState().leaveSession(agent.currentChatId, agentId);
      chatTickCounts.delete(agentId);
      // Break from chatting so the agent moves/acts instead of instantly
      // re-entering another conversation.
      setChatCooldown(agentId, CHAT_COOLDOWN_AFTER_TIMEOUT_MS);
      // After force-leaving, fall through to the "not in chat" branch below
    }
  } else {
    // Not in a chat — reset tracker
    chatTickCounts.delete(agentId);
  }

  // Re-read agent state after possible force-leave
  const agentAfterTimeout = agentsStore.getAgent(agentId);

  // Chat context — this is the critical section for back-and-forth conversation
  if (agentAfterTimeout?.currentChatId) {
    const chatsStore = useChatsStore.getState();
    const session = chatsStore.getAgentSession(agentId);
    if (session) {
      const participantBits = session.participants
        .filter((pid) => pid !== agentId)
        .map((pid) => {
          const name = agentsStore.getAgent(pid)?.name ?? pid;
          const region = getAgentRegion(pid);
          const where =
            !region || region === "unknown" ? "" : ` (in ${region})`;
          return `${name}${where}`;
        })
        .join(", ");

      const messages = session.messages;
      if (messages.length > 0) {
        const chatLines = messages
          .slice(-10)
          .map((m) => `${m.name}: ${m.content}`);
        const lastMsg = messages[messages.length - 1];
        const lastSpeakerIsMe = lastMsg.id === agentId;

        sections.push(
          `[ACTIVE CONVERSATION with ${participantBits}]\n` +
            `These people are with you — you can see them and already know where they are. Do not ask.\n` +
            `${chatLines.join("\n")}\n` +
            (lastSpeakerIsMe
              ? `(You spoke last. Wait for a response, or use leave_chat if done.)`
              : `(${lastMsg.name} just spoke. You MUST respond using the "say" tool now.)`),
        );
      } else {
        sections.push(
          `[ACTIVE CONVERSATION with ${participantBits}]\n` +
            `These people are with you — you can see them and already know where they are. Do not ask.\n` +
            `(Conversation just started. Use the "say" tool to greet them.)`,
        );
      }
    }
  } else {
    // Not in a chat — check if someone nearby might want to talk
    const chatsStore = useChatsStore.getState();
    const nearby = chatsStore.getNearbyAgents(agentId);
    const nearbyInChat = nearby.filter((n) => n.inChat);
    if (nearbyInChat.length > 0) {
      const names = nearbyInChat.map((n) => n.name).join(", ");
      sections.push(
        `[Note] ${names} ${nearbyInChat.length === 1 ? "is" : "are"} in a conversation nearby. You could use start_chat to join.`,
      );
    }

    // Standing still too long: nudge toward purposeful movement.
    const idleMs = Date.now() - (lastMoveAt.get(agentId) ?? Date.now());
    if (idleMs > RESTLESS_AFTER_MS) {
      sections.push(
        `[Restlessness] You have been standing in ${myRegion} without moving for over ${Math.floor(idleMs / 60000)} minute(s). Do not linger in one spot — use move_to_region to go somewhere purposeful now (patrol, explore, or go where you are needed).`,
      );
    }

    // On a chat break after an overlong conversation.
    const cooldownMs = getChatCooldownRemaining(agentId);
    if (cooldownMs > 0) {
      sections.push(
        `[Chat Break] You just spent a long time in one conversation. For the next ${Math.ceil(cooldownMs / 1000)}s you cannot start or join chats — move and act instead.`,
      );
    }
  }

  return sections.filter(Boolean).join("\n\n");
}

// --- Tool composition ---

/**
 * Build tools for an agent. All deps use fresh getState() calls so they
 * always read the latest store values (not stale snapshots).
 */

function buildTools(
  agentId: string,
  runtime: AgentRuntime,
): Record<string, any> {
  if (!bridgeFns) {
    console.warn(`[AI] Bridge not ready, no tools for ${agentId}`);
    return {};
  }

  const bf = bridgeFns;

  const baseTools = {
    ...createMoveTools({
      agentId,
      getRegions: () => bf.getRegions(),
      moveTo: bf.moveTo,
      isGuard: runtime.config.role === "guard",
      forceMoveTo: runtime.config.role === "guard" ? bf.forceMoveTo : undefined,
      getPrisoners: () =>
        useAgentsStore
          .getState()
          .getAllAgents()
          .filter((a) => a.role === "prisoner")
          .map((a) => ({ id: a.id, name: a.name })),
      getRegionOf: (id) => getAgentRegion(id),
      onEscorted: (prisonerName, from, to) => {
        if (to === "Solitary")
          recordConfinement(prisonerName, runtime.config.name);
        else if (from === "Solitary")
          recordRelease(prisonerName, runtime.config.name);
      },
      getCurrentRegion: () => getAgentRegion(agentId),
      assignedCell:
        runtime.config.role === "prisoner"
          ? getAssignedCell(runtime.config.name)
          : null,
      getGameTime: getCurrentGameTime,
      onMoveStart: (id, label, isForced, targetId) => {
        lastMoveAt.set(id, Date.now());
        if (targetId) lastMoveAt.set(targetId, Date.now());
        useAgentsStore.getState().updateMoveBubble(id, {
          content: `${isForced ? "🔗" : "🚶"} ${label}`,
          timestamp: Date.now(),
          duration: 5000,
          isForced,
        });
        if (isForced && targetId) {
          useAgentsStore.getState().updateMoveBubble(targetId, {
            content: `🔗 ${label}`,
            timestamp: Date.now(),
            duration: 5000,
            isForced: true,
          });
        }
      },
    }),
    ...createChatTools({
      agentId,
      agentName: runtime.config.name,
      getCurrentChatId: () =>
        useAgentsStore.getState().getAgent(agentId)?.currentChatId ?? null,
      getNearbyAgents: () => useChatsStore.getState().getNearbyAgents(agentId),
      getRegionOf: (id) => getAgentRegion(id),
      getKnownAgents: () =>
        useAgentsStore
          .getState()
          .getAllAgents()
          .map((a) => ({ id: a.id, name: a.name })),
      isGuard: runtime.config.role === "guard",
      createChat: (ids) => useChatsStore.getState().createSession(ids),
      joinChat: (chatId) =>
        useChatsStore.getState().joinSession(chatId, agentId),
      leaveChat: (chatId) =>
        useChatsStore.getState().leaveSession(chatId, agentId),
      sendMessage: (chatId, msg) =>
        useChatsStore.getState().sendMessage(chatId, msg),
      getMessages: (chatId) => useChatsStore.getState().getMessages(chatId),
      onMessageSent: notifyChatPartners,
      canAdjustCScore: runtime.config.role === "guard",
      getChatParticipants: (chatId) => {
        const session = useChatsStore
          .getState()
          .getAllSessions()
          .find((s) => s.id === chatId);
        if (!session) return [];
        const store = useAgentsStore.getState();
        return session.participants
          .map((pid) => store.getAgent(pid))
          .filter((a): a is NonNullable<typeof a> => !!a)
          .map((a) => ({ id: a.id, name: a.name, role: a.role }));
      },
      adjustCScore: (prisonerId, delta) => {
        const store = useAgentsStore.getState();
        if (delta >= 0) store.addPoints(prisonerId, delta);
        else store.subtractPoints(prisonerId, -delta);
        return store.getPoints(prisonerId);
      },
      getChatCooldownMs: () => getChatCooldownRemaining(agentId),
    }),
    ...createMemoryTool(runtime.memoryStore),
    ...createRelationshipTools(runtime.relationshipState),
    ...createEmotionsTool(runtime.emotionState, {
      onEmotionChange: (emoji) =>
        useAgentsStore.getState().updateEmoji(agentId, emoji),
    }),
  };

  // Guard-only tools
  if (runtime.config.role === "guard") {
    Object.assign(
      baseTools,
      createDoorTools({
        agentId,
        findDoorByRegions: bf.findDoorByRegions,
        getAllDoorStates: bf.getAllDoorStates,
        moveTo: bf.moveTo,
      }),
      createTaskTools({
        guardName: runtime.config.name,
        getPrisonerNames: () =>
          useAgentsStore
            .getState()
            .getAllAgents()
            .filter((a) => a.role === "prisoner")
            .map((a) => a.name),
        isWorkDetail: () => {
          const now = getCurrentGameTime();
          return now ? getSchedulePhase(now) === "work_detail" : false;
        },
      }),
    );
  }

  return baseTools;
}

// --- Tick scheduling ---

/** Track pending fast-tick timers so we can avoid duplicates. */
const pendingFastTicks = new Set<string>();

/**
 * Determine how long to wait before the next tick.
 * - If in a conversation where the other person spoke last: 2s (fast reply)
 * - Otherwise: 8s (normal exploration pace)
 */
function getTickDelay(agentId: string): number {
  const agent = useAgentsStore.getState().getAgent(agentId);
  if (!agent?.currentChatId) return 8000;

  const session = useChatsStore.getState().getAgentSession(agentId);
  if (!session || session.messages.length === 0) return 8000;

  const lastMsg = session.messages[session.messages.length - 1];
  if (lastMsg.id !== agentId) {
    // Someone else spoke last — we should respond quickly
    return 2000;
  }

  return 8000;
}

/**
 * The participant a message is addressed to ("Prisoner #N"/"Guard #N", or a
 * guard when a prisoner says "officer"), or null if it can't be resolved.
 */
function addressedRecipient(chatId: string, speakerId: string): string | null {
  const session = useChatsStore.getState().sessions[chatId];
  if (!session || session.messages.length === 0) return null;
  const text = session.messages[session.messages.length - 1].content;
  const store = useAgentsStore.getState();
  const others = session.participants
    .filter((pid) => pid !== speakerId)
    .map((pid) => ({ pid, agent: store.getAgent(pid) }))
    .filter((x) => !!x.agent);

  const named = text.match(/(prisoner|guard)\s*#?\s*(\d+)/i);
  if (named) {
    const want = `${named[1]} #${named[2]}`.toLowerCase();
    const hit = others.find((x) => x.agent!.name.toLowerCase() === want);
    if (hit) return hit.pid;
  }
  if (/\bofficer\b/i.test(text)) {
    const guard = others.find((x) => x.agent!.role === "guard");
    if (guard) return guard.pid;
  }
  return null;
}

/**
 * After a message is sent, fast-tick the addressed participant so they get the
 * next turn (or everyone, when the recipient can't be identified).
 */
export function notifyChatPartners(chatId: string, speakerId: string): void {
  const session = useChatsStore.getState().sessions[chatId];
  if (!session) return;

  const addressed = addressedRecipient(chatId, speakerId);
  const recipients = addressed
    ? [addressed]
    : session.participants.filter((pid) => pid !== speakerId);

  for (const pid of recipients) {
    if (pid === speakerId) continue;
    const runtime = agentRuntimes.get(pid);
    if (!runtime || !runtime.running) continue;

    // Only schedule if we don't already have a fast tick pending
    if (!pendingFastTicks.has(pid)) {
      pendingFastTicks.add(pid);
      console.log(`[AI] ${pid}: Fast tick (addressed by ${speakerId})`);
      setTimeout(() => {
        pendingFastTicks.delete(pid);
        tickAgent(pid);
      }, 1500);
    }
  }
}

// --- Tick loop ---

/**
 * Hard cap on a single LLM call. Must sit above the serverless backend's
 * ~90s cold start; a call stalled longer is presumed hung. Without it a
 * stalled fetch never settles and the tick loop stops rescheduling.
 */
const LLM_CALL_TIMEOUT_MS = 120_000;

/**
 * First-call cap while the warmup gate is exclusive. Cold start (~90s)
 * plus one generation can exceed 120s when only a single request is
 * allowed through; aborting it restarts the worker and the spiral.
 */
const LLM_WARMUP_TIMEOUT_MS = 180_000;

/**
 * Agents with a tick in flight. A duplicate tick (fast-tick, watchdog
 * restart) is dropped rather than queued — the running tick reschedules
 * itself when it completes.
 */
const activeTicks = new Set<string>();

/** Last time each agent entered tickAgent; the watchdog restarts stalled loops. */
const lastTickAt = new Map<string, number>();

async function tickAgent(agentId: string): Promise<void> {
  const runtime = agentRuntimes.get(agentId);
  if (!runtime || !runtime.running) return;

  // Don't tick if bridge isn't ready yet
  if (!bridgeFns) {
    console.log(`[AI] ${agentId}: Waiting for bridge...`);
    setTimeout(() => tickAgent(agentId), 2000);
    return;
  }

  if (activeTicks.has(agentId)) return;
  activeTicks.add(agentId);
  lastTickAt.set(agentId, Date.now());

  let holdWarmupSlot = false;
  let callTimeoutMs = LLM_CALL_TIMEOUT_MS;
  try {
    // One in-flight request until the first success, so a cold serverless
    // backend is not flooded by 9 concurrent aborts. No-op once warm.
    const warmupHeartbeat = setInterval(() => {
      lastTickAt.set(agentId, Date.now());
    }, 30_000);
    try {
      await acquireWarmupSlot(agentId);
    } finally {
      clearInterval(warmupHeartbeat);
    }
    holdWarmupSlot = !isBackendWarmedUp();
    if (!runtime.running) return;

    callTimeoutMs = holdWarmupSlot
      ? LLM_WARMUP_TIMEOUT_MS
      : LLM_CALL_TIMEOUT_MS;

    // Build context/tools just before the call so dynamic state (region,
    // chat partners, points, etc.) is fresh when we actually hit the API,
    // not when we were originally queued behind the rate limiter.
    const result = await scheduleAgentCall(agentId, runtime.config.role, () => {
      const dynamicContext = buildDynamicContext(agentId, runtime);
      const tools = buildTools(agentId, runtime);

      console.log(
        `[AI] ${agentId}: Tick (${Object.keys(tools).length} tools, ${runtime.messages.length} msgs)`,
      );

      return generateText({
        model: getModel(runtime.config.role),
        system: runtime.systemPrompt + "\n\n" + dynamicContext,
        messages: runtime.messages,
        tools,
        // A hung request (serverless worker stall) must fail, not wait
        // forever — see LLM_CALL_TIMEOUT_MS / LLM_WARMUP_TIMEOUT_MS.
        abortSignal: AbortSignal.timeout(callTimeoutMs),
        maxSteps: 5,
        // Larger than strictly needed for OpenAI/OpenRouter models, but
        // thinking/reasoning models (e.g. Qwen3.6 which emits an internal
        // `reasoning` channel before the user-visible content) easily use
        // 500-1500 tokens on reasoning alone.
        maxTokens: 4000,
        onStepFinish({ finishReason, toolCalls }) {
          if (toolCalls && toolCalls.length > 0) {
            for (const tc of toolCalls) {
              console.log(
                `[AI] ${agentId}: tool ${tc.toolName}(${JSON.stringify(tc.args)})`,
              );
            }
          } else if (finishReason === "stop" || finishReason === "length") {
            console.log(`[AI] ${agentId}: finished (${finishReason})`);
          }
        },
      });
    });

    markBackendWarmedUp();
    holdWarmupSlot = false;

    // Append all response messages to history for continuity
    if (result.response?.messages) {
      runtime.messages.push(...result.response.messages);

      // Persist to the append-only log (never trimmed)
      const region = getAgentRegion(agentId);
      const now = Date.now();
      for (const msg of result.response.messages) {
        messageLog.push({
          agentId,
          agentName: runtime.config.name,
          agentRole: runtime.config.role,
          currentRegion: region,
          role: msg.role,
          content:
            typeof msg.content === "string"
              ? msg.content
              : JSON.stringify(msg.content),
          timestamp: now,
        });
      }
    }

    // Trim history to prevent context overflow. Use safe trim to avoid
    // orphaning a `tool` message at index 0 (which would cause every
    // subsequent API call to 400 until the runtime is reset).
    if (runtime.messages.length > 40) {
      runtime.messages = safeTrimMessages(runtime.messages, 30);
    }

    // Check for hourly C-score snapshot
    checkHourlyCScoreSnapshot();

    // Show the agent's final text as a thought bubble
    if (result.text) {
      useAgentsStore.getState().updateThoughtBubble(agentId, {
        content: result.text,
        timestamp: Date.now(),
        duration: 10000,
      });
    }

    // Log step summary
    const toolCallCount =
      result.steps?.reduce((sum, s) => sum + (s.toolCalls?.length ?? 0), 0) ??
      0;
    if (toolCallCount > 0 || result.text) {
      console.log(
        `[AI] ${agentId}: Completed (${result.steps?.length ?? 0} steps, ${toolCallCount} tool calls)${result.text ? ` - "${result.text.slice(0, 80)}..."` : ""}`,
      );
    }

    // --- Text-to-tool-call fallback for reasoning models ---
    //
    // Some models (notably Qwen3-family thinking models) occasionally
    // describe the action they want to take in plain text instead of
    // emitting the corresponding tool call, e.g. the response text is
    // `"say: Hello there."` with zero tool_calls. If the agent is in a
    // chat and no `say` tool was called this tick, recover the message
    // from the text and send it as a chat message. Prevents dropped
    // utterances without requiring a re-prompt.
    const recoveredSayFromText = recoverSayFromText({
      agentId,
      agentName: runtime.config.name,
      text: result.text,
      toolCallsThisTick: result.steps?.flatMap((s) => s.toolCalls ?? []) ?? [],
    });
    if (recoveredSayFromText) {
      console.log(
        `[AI] ${agentId}: Recovered say from text: "${recoveredSayFromText.slice(0, 80)}${recoveredSayFromText.length > 80 ? "..." : ""}"`,
      );
    }

    // Schedule next tick — faster if in an active conversation waiting for our reply
    const nextDelay = getTickDelay(agentId);
    setTimeout(() => tickAgent(agentId), nextDelay);
  } catch (error: unknown) {
    const err = error as {
      name?: string;
      status?: number;
      statusCode?: number;
      message?: string;
      data?: unknown;
      responseBody?: string;
    };
    const status = err?.status ?? err?.statusCode;
    const is429 = status === 429 || err?.message?.includes("429");

    // Our own abort timeout or a rate-limiter job expiration: expected
    // while the serverless backend cold-starts or a worker stalls.
    // Retry soon, without a stack trace.
    if (isTimeoutError(err)) {
      console.warn(
        `[AI] ${agentId}: LLM call timed out after ${callTimeoutMs / 1000}s (backend cold start or stalled worker), retrying in 5s`,
      );
      setTimeout(() => tickAgent(agentId), 5000);
      return;
    }
    const is400 =
      status === 400 ||
      err?.message?.includes("400") ||
      err?.responseBody?.includes("tool") ||
      err?.message?.toLowerCase().includes("tool_call");

    // Model emitted a tool call with invalid/missing arguments (e.g.
    // Qwen3.6 sometimes calls `say({})` with no `message`). This is a
    // soft error — no corruption, no rate limiting — just a model
    // hiccup. Skip this tick quickly without the full stack trace.
    const isInvalidToolArgs =
      err?.name === "AI_InvalidToolArgumentsError" ||
      (err?.message?.includes("Invalid arguments for tool") &&
        err?.message?.includes("Type validation failed"));

    if (isInvalidToolArgs) {
      // Extract just the tool name from the error message for a clean log.
      const toolMatch = err?.message?.match(/tool\s+([a-z_]+):/i);
      const toolName = toolMatch ? toolMatch[1] : "unknown";
      console.warn(
        `[AI] ${agentId}: Model emitted malformed ${toolName}() call (missing required args), skipping tick`,
      );
      setTimeout(() => tickAgent(agentId), 2000);
      return;
    }

    // Self-heal: if the message history is corrupted (starts with an
    // orphan `tool` message) OR we got a 400 that smells like a
    // tool-call / tool-result mismatch, reset the runtime to its initial
    // state so the agent can recover instead of looping on the same
    // broken request forever.
    const runtime = agentRuntimes.get(agentId);
    const corrupted = runtime && isMessageHistoryCorrupted(runtime.messages);
    if (runtime && (corrupted || is400)) {
      console.warn(
        `[AI] ${agentId}: Resetting message history ${corrupted ? "(orphan tool at index 0)" : "(400 — likely tool-call/result mismatch)"}`,
      );
      runtime.messages = [{ role: "user", content: INITIAL_USER_MESSAGE }];
    }

    const backoff = is429 ? 30000 : 5000;
    const reason = is429
      ? "429 rate limited"
      : is400
        ? `400 ${err?.message ?? ""}`.trim()
        : (err?.message ?? "unknown");
    console.warn(
      `[AI] ${agentId}: Tick failed (${reason}), retry in ${backoff / 1000}s`,
    );
    if (!is429) console.error("[AI] Full error:", error);
    setTimeout(() => tickAgent(agentId), backoff);
  } finally {
    if (holdWarmupSlot) releaseWarmupSlot();
    activeTicks.delete(agentId);
  }
}

// --- Tick watchdog ---

/**
 * Last-resort recovery: if an agent's loop stops rescheduling (an
 * unsettled await, a lost timer), restart it. The abort timeout and job
 * expiration should make this unreachable, but a silently dead agent
 * corrupts a whole run, so it is worth the belt and braces.
 */
const WATCHDOG_STALL_MS = 5 * 60_000;
const WATCHDOG_INTERVAL_MS = 60_000;
let watchdogStarted = false;

function startTickWatchdog(): void {
  if (watchdogStarted) return;
  watchdogStarted = true;
  setInterval(() => {
    const now = Date.now();
    for (const [agentId, runtime] of agentRuntimes) {
      if (!runtime.running) continue;
      const last = lastTickAt.get(agentId) ?? 0;
      if (last > 0 && now - last > WATCHDOG_STALL_MS) {
        console.warn(
          `[AI] ${agentId}: No tick for ${Math.round((now - last) / 1000)}s — watchdog restarting the loop`,
        );
        activeTicks.delete(agentId);
        tickAgent(agentId);
      }
    }
  }, WATCHDOG_INTERVAL_MS);
}

// --- Public API ---

/** Initialize all agents and start their tick loops. */
export function initAgents(agents: AgentConfig[]): void {
  resetBackendWarmup();
  console.log(`[AI] Initializing ${agents.length} agents...`);

  agents.forEach((config, index) => {
    const runtime: AgentRuntime = {
      config,
      systemPrompt: buildSystemPrompt(config),
      messages: [{ role: "user", content: INITIAL_USER_MESSAGE }],
      memoryStore: new MemoryStore(),
      relationshipState: new RelationshipState(),
      emotionState: new EmotionState(),
      running: true,
    };

    agentRuntimes.set(config.id, runtime);
    lastMoveAt.set(config.id, Date.now());

    // Persist the initial message to the log
    messageLog.push({
      agentId: config.id,
      agentName: config.name,
      agentRole: config.role,
      currentRegion: "unknown", // bridge not ready yet at init time
      role: "user",
      content: INITIAL_USER_MESSAGE,
      timestamp: Date.now(),
    });

    // Stagger initial starts so we don't flood the API
    const delay = 3000 + index * 2000;
    console.log(
      `[AI] ${config.id} (${config.name}): First tick in ${delay / 1000}s`,
    );
    // Stamp now so the watchdog also covers an agent whose very first
    // tick never happens.
    lastTickAt.set(config.id, Date.now());
    setTimeout(() => tickAgent(config.id), delay);
  });

  startTickWatchdog();
}

/** Stop all agent tick loops. */
export function stopAllAgents(): void {
  for (const runtime of agentRuntimes.values()) {
    runtime.running = false;
  }
}

/** Get the total number of messages across all agents. */
export function getTotalMessages(): number {
  let total = 0;
  for (const runtime of agentRuntimes.values()) {
    total += runtime.messages.length;
  }
  return total;
}

/** Determine which region an agent is currently in based on their world position. */
export function getAgentRegion(agentId: string): string {
  if (!bridgeFns) return "unknown";

  // Use world-space coordinates from the Phaser sprite (not screen coords from Zustand)
  const worldPos = bridgeFns.getAgentWorldPosition(agentId);
  if (!worldPos) return "unknown";

  const regions = bridgeFns.getRegions();
  for (const region of regions) {
    if (
      worldPos.x >= region.x &&
      worldPos.x <= region.x + region.width &&
      worldPos.y >= region.y &&
      worldPos.y <= region.y + region.height
    ) {
      return region.label;
    }
  }
  return "unknown";
}

/** Export all agent messages as JSONL for analysis. */
export function exportMessagesAsJSONL(): string {
  const allLines: Array<Record<string, unknown>> = [];
  const agentsStore = useAgentsStore.getState();

  // 1. All LLM messages from the persistent log (complete history, never trimmed)
  for (const entry of messageLog) {
    allLines.push({ ...entry });
  }

  // 2. All chat messages, with each line's running C-Score total accumulated
  // from the per-message deltas in timestamp order.
  const chatMsgs: Array<{
    sessionId: string;
    participants: string[];
    msg: ChatMessage;
  }> = [];
  for (const session of useChatsStore.getState().getAllSessions()) {
    for (const msg of session.messages) {
      chatMsgs.push({
        sessionId: session.id,
        participants: session.participants,
        msg,
      });
    }
  }
  chatMsgs.sort((a, b) => a.msg.timestamp - b.msg.timestamp);
  const runningCScore: Record<string, number> = {};
  for (const p of agentsStore.getAllPrisonerPoints()) runningCScore[p.name] = 0;
  for (const { sessionId, participants, msg } of chatMsgs) {
    if (msg.cScoreChange) {
      const { target, delta } = msg.cScoreChange;
      runningCScore[target] = (runningCScore[target] ?? 0) + delta;
    }
    allLines.push({
      agentId: msg.id,
      agentName: msg.name,
      currentRegion: getAgentRegion(msg.id),
      role: "chat",
      content: msg.content,
      timestamp: msg.timestamp,
      chatId: sessionId,
      // Who was actually present when this message was sent (send-time
      // snapshot); chatParticipants is the session's final roster.
      to: (msg.recipients ?? participants.filter((pid) => pid !== msg.id)).map(
        (pid) => agentsStore.getAgent(pid)?.name ?? pid,
      ),
      chatParticipants: participants.map(
        (pid) => agentsStore.getAgent(pid)?.name ?? pid,
      ),
      c_score: { ...runningCScore },
      ...(msg.cScoreChange ? { c_score_change: msg.cScoreChange } : {}),
    });
  }

  // 3. Hourly C-score snapshots
  for (const snapshot of cScoreSnapshots) {
    allLines.push({
      role: "cscore_snapshot",
      simulationTime: snapshot.simulationTime,
      timestamp: snapshot.realTimestamp,
      scores: snapshot.scores,
    });
  }

  // 4. Final C-score snapshot at download time
  const simTime = getCurrentGameTime();
  const prisoners = agentsStore
    .getAllAgents()
    .filter((a) => a.role === "prisoner");

  if (simTime) {
    const hours = simTime.getHours();
    const minutes = simTime.getMinutes().toString().padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    const h12 = hours % 12 || 12;

    allLines.push({
      role: "cscore_snapshot",
      simulationTime: `${h12}:${minutes} ${ampm} (at download)`,
      timestamp: Date.now(),
      scores: prisoners.map((p) => ({
        id: p.id,
        name: p.name,
        points: p.points,
        region: getAgentRegion(p.id),
      })),
    });
  }

  // Sections above are appended by kind, not time, so sort the whole export by
  // timestamp for a single coherent timeline.
  allLines.sort(
    (a, b) => ((a.timestamp as number) ?? 0) - ((b.timestamp as number) ?? 0),
  );

  return allLines.map((m) => JSON.stringify(m)).join("\n");
}
