/**
 * Core AI Agent Runner
 *
 * Each agent is a tool-loop agent: generateText with maxSteps allows the model
 * to call tools iteratively until it finishes or hits the step limit.
 * Every ~8 seconds, each agent gets a fresh tick with updated dynamic context.
 */

import { generateText, type CoreMessage } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

import type { AgentConfig, RegionConfig } from '@/engine/types';
import { useAgentsStore } from '@/store/agents';
import { useChatsStore } from '@/store/chats';

import { RateLimiter } from './rate-limiter';
import { getTimeContext } from './context/time';
import { getNearbyContext } from './context/nearby';

import { createMoveTools } from './tools/move';
import { createChatTools } from './tools/chat';
import { createDoorTools, getDoorContext } from './tools/door';
import { createMemoryTool, MemoryStore } from './tools/memory';
import { createEmotionsTool, EmotionState } from './tools/emotions';
import { createRelationshipTools, RelationshipState } from './tools/relationship';
import { createPointsTools, getPointsContext } from './tools/points';

import { getPrisonerPrompt } from '@/scenarios/prison/prompts/prisoner';
import { getGuardPrompt } from '@/scenarios/prison/prompts/guard';

// --- State per agent ---

interface AgentRuntime {
  config: AgentConfig;
  systemPrompt: string;
  messages: CoreMessage[];
  memoryStore: MemoryStore;
  emotionState: EmotionState;
  relationshipState: RelationshipState;
  running: boolean;
}

const agentRuntimes = new Map<string, AgentRuntime>();
const rateLimiter = new RateLimiter(800);

// --- Bridge functions (set by the Phaser engine) ---

export interface BridgeFunctions {
  moveTo: (agentId: string, x: number, y: number) => Promise<boolean>;
  forceMoveTo: (guardId: string, prisonerId: string, x: number, y: number) => Promise<boolean>;
  findDoorByRegions: (r1: string, r2: string) => { door: unknown; lock: (d: unknown) => boolean; unlock: (d: unknown) => boolean } | null;
  getAllDoorStates: () => Array<{ region1: string; region2: string; isLocked: boolean }>;
  getRegions: () => RegionConfig[];
}

let bridgeFns: BridgeFunctions | null = null;

export function setBridgeFunctions(fns: BridgeFunctions) {
  bridgeFns = fns;
  console.log('[AI] Bridge functions set. Regions available:', fns.getRegions().length);
}

// --- OpenRouter model ---

let model: ReturnType<ReturnType<typeof createOpenAI>> | null = null;

function getModel() {
  if (model) return model;
  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY || '';
  if (!apiKey) {
    console.error('[AI] VITE_OPENROUTER_API_KEY is not set! Agents will not work.');
  }
  const openrouter = createOpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey,
  });
  model = openrouter('openrouter/free');
  return model;
}

// --- System prompt builder ---

function buildSystemPrompt(agentConfig: AgentConfig): string {
  const number = agentConfig.name.replace(/[^0-9]/g, '') || '1';

  if (agentConfig.role === 'guard') {
    const prisoners = useAgentsStore
      .getState()
      .getAllAgents()
      .filter((a) => a.role === 'prisoner')
      .map((p) => p.name.replace(/[^0-9]/g, ''))
      .filter(Boolean)
      .join(', ');
    return getGuardPrompt(number, prisoners || '1, 2, 3, 4, 5');
  }

  return getPrisonerPrompt(number);
}

function buildDynamicContext(agentId: string, runtime: AgentRuntime): string {
  const sections: string[] = [];

  sections.push(getTimeContext());
  sections.push(getNearbyContext(agentId));
  sections.push(runtime.memoryStore.getContext());
  sections.push(runtime.emotionState.getContext());
  sections.push(runtime.relationshipState.getContext());

  // Points context
  const agentsStore = useAgentsStore.getState();
  sections.push(
    getPointsContext({
      agentId,
      role: runtime.config.role,
      getPoints: (id) => useAgentsStore.getState().getPoints(id),
      getAllPrisonerPoints: () => useAgentsStore.getState().getAllPrisonerPoints(),
    }),
  );

  // Door states
  if (bridgeFns) {
    sections.push(getDoorContext({ getAllDoorStates: bridgeFns.getAllDoorStates }));
  }

  // Available regions (so the agent knows what move targets exist)
  // Filter out "Escape" — agents shouldn't navigate there directly
  if (bridgeFns) {
    const regions = bridgeFns.getRegions().filter((r) => r.label !== 'Escape');
    if (regions.length > 0) {
      const regionNames = regions.map((r) => r.label).join(', ');
      sections.push(`[Available Regions] ${regionNames}`);
    }
  }

  // Chat context — this is the critical section for back-and-forth conversation
  const agent = agentsStore.getAgent(agentId);
  if (agent?.currentChatId) {
    const chatsStore = useChatsStore.getState();
    const session = chatsStore.getAgentSession(agentId);
    if (session) {
      const participantNames = session.participants
        .filter((pid) => pid !== agentId)
        .map((pid) => agentsStore.getAgent(pid)?.name ?? pid)
        .join(', ');

      const messages = session.messages;
      if (messages.length > 0) {
        const chatLines = messages.slice(-10).map((m) => `${m.name}: ${m.content}`);
        const lastMsg = messages[messages.length - 1];
        const lastSpeakerIsMe = lastMsg.id === agentId;

        sections.push(
          `[ACTIVE CONVERSATION with ${participantNames}]\n` +
          `${chatLines.join('\n')}\n` +
          (lastSpeakerIsMe
            ? `(You spoke last. Wait for a response, or use leave_chat if done.)`
            : `(${lastMsg.name} just spoke. You MUST respond using the "say" tool now.)`)
        );
      } else {
        sections.push(
          `[ACTIVE CONVERSATION with ${participantNames}]\n` +
          `(Conversation just started. Use the "say" tool to greet them.)`
        );
      }
    }
  } else {
    // Not in a chat — check if someone nearby might want to talk
    const chatsStore = useChatsStore.getState();
    const nearby = chatsStore.getNearbyAgents(agentId);
    const nearbyInChat = nearby.filter((n) => n.inChat);
    if (nearbyInChat.length > 0) {
      const names = nearbyInChat.map((n) => n.name).join(', ');
      sections.push(`[Note] ${names} ${nearbyInChat.length === 1 ? 'is' : 'are'} in a conversation nearby. You could use start_chat to join.`);
    }
  }

  return sections.filter(Boolean).join('\n\n');
}

// --- Tool composition ---

/**
 * Build tools for an agent. All deps use fresh getState() calls so they
 * always read the latest store values (not stale snapshots).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildTools(agentId: string, runtime: AgentRuntime): Record<string, any> {
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
      forceMoveTo: runtime.config.role === 'guard' ? bf.forceMoveTo : undefined,
      onMoveStart: (id, label, isForced, targetId) => {
        useAgentsStore.getState().updateMoveBubble(id, {
          content: `${isForced ? '🔗' : '🚶'} ${label}`,
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
      getCurrentChatId: () => useAgentsStore.getState().getAgent(agentId)?.currentChatId ?? null,
      getNearbyAgents: () => useChatsStore.getState().getNearbyAgents(agentId),
      createChat: (ids) => useChatsStore.getState().createSession(ids),
      joinChat: (chatId) => useChatsStore.getState().joinSession(chatId, agentId),
      leaveChat: (chatId) => useChatsStore.getState().leaveSession(chatId, agentId),
      sendMessage: (chatId, msg) => useChatsStore.getState().sendMessage(chatId, msg),
      getMessages: (chatId) => useChatsStore.getState().getMessages(chatId),
      onMessageSent: notifyChatPartners,
    }),
    ...createMemoryTool(runtime.memoryStore),
    ...createEmotionsTool(runtime.emotionState, {
      onEmotionChange: (emoji) => useAgentsStore.getState().updateEmoji(agentId, emoji),
    }),
    ...createRelationshipTools(runtime.relationshipState),
  };

  // Guard-only tools
  if (runtime.config.role === 'guard') {
    Object.assign(baseTools, createDoorTools({
      agentId,
      findDoorByRegions: bf.findDoorByRegions,
      getAllDoorStates: bf.getAllDoorStates,
      moveTo: bf.moveTo,
    }));
    Object.assign(baseTools, createPointsTools({
      agentId,
      role: 'guard',
      getPoints: (id) => useAgentsStore.getState().getPoints(id),
      addPoints: (id, pts) => useAgentsStore.getState().addPoints(id, pts),
      subtractPoints: (id, pts) => useAgentsStore.getState().subtractPoints(id, pts),
      getAllPrisonerPoints: () => useAgentsStore.getState().getAllPrisonerPoints(),
      getAgentName: (id) => useAgentsStore.getState().getAgent(id)?.name ?? id,
    }));
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
 * When a message is sent in a chat, notify the other participants
 * to tick sooner so they can respond. This creates the back-and-forth flow.
 */
export function notifyChatPartners(chatId: string, speakerId: string): void {
  const session = useChatsStore.getState().sessions[chatId];
  if (!session) return;

  for (const pid of session.participants) {
    if (pid === speakerId) continue;
    const runtime = agentRuntimes.get(pid);
    if (!runtime || !runtime.running) continue;

    // Only schedule if we don't already have a fast tick pending
    if (!pendingFastTicks.has(pid)) {
      pendingFastTicks.add(pid);
      console.log(`[AI] ${pid}: Fast tick (responding to ${speakerId} in chat)`);
      setTimeout(() => {
        pendingFastTicks.delete(pid);
        tickAgent(pid);
      }, 1500);
    }
  }
}

// --- Tick loop ---

async function tickAgent(agentId: string): Promise<void> {
  const runtime = agentRuntimes.get(agentId);
  if (!runtime || !runtime.running) return;

  // Don't tick if bridge isn't ready yet
  if (!bridgeFns) {
    console.log(`[AI] ${agentId}: Waiting for bridge...`);
    setTimeout(() => tickAgent(agentId), 2000);
    return;
  }

  try {
    await rateLimiter.wait();

    const dynamicContext = buildDynamicContext(agentId, runtime);
    const tools = buildTools(agentId, runtime);

    console.log(`[AI] ${agentId}: Tick (${Object.keys(tools).length} tools, ${runtime.messages.length} msgs)`);

    const result = await generateText({
      model: getModel(),
      system: runtime.systemPrompt + '\n\n' + dynamicContext,
      messages: runtime.messages,
      tools,
      maxSteps: 5,
      maxTokens: 1000,
      onStepFinish({ finishReason, toolCalls }) {
        if (toolCalls && toolCalls.length > 0) {
          for (const tc of toolCalls) {
            console.log(`[AI] ${agentId}: tool ${tc.toolName}(${JSON.stringify(tc.args)})`);
          }
        } else if (finishReason === 'stop' || finishReason === 'length') {
          console.log(`[AI] ${agentId}: finished (${finishReason})`);
        }
      },
    });

    // Append all response messages to history for continuity
    if (result.response?.messages) {
      runtime.messages.push(...result.response.messages);
    }

    // Trim history to prevent context overflow
    if (runtime.messages.length > 40) {
      runtime.messages = runtime.messages.slice(-30);
    }

    // Show the agent's final text as a thought bubble
    if (result.text) {
      useAgentsStore.getState().updateThoughtBubble(agentId, {
        content: result.text,
        timestamp: Date.now(),
        duration: 10000,
      });
    }

    // Log step summary
    const toolCallCount = result.steps?.reduce((sum, s) => sum + (s.toolCalls?.length ?? 0), 0) ?? 0;
    if (toolCallCount > 0 || result.text) {
      console.log(`[AI] ${agentId}: Completed (${result.steps?.length ?? 0} steps, ${toolCallCount} tool calls)${result.text ? ` - "${result.text.slice(0, 80)}..."` : ''}`);
    }

    // Schedule next tick — faster if in an active conversation waiting for our reply
    const nextDelay = getTickDelay(agentId);
    setTimeout(() => tickAgent(agentId), nextDelay);
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string; data?: unknown };
    const is429 = err?.status === 429 || err?.message?.includes('429');
    const backoff = is429 ? 30000 : 5000;
    console.warn(`[AI] ${agentId}: Tick failed (${is429 ? '429 rate limited' : err?.message ?? 'unknown'}), retry in ${backoff / 1000}s`);
    if (!is429) console.error('[AI] Full error:', error);
    setTimeout(() => tickAgent(agentId), backoff);
  }
}

// --- Public API ---

/** Initialize all agents and start their tick loops. */
export function initAgents(agents: AgentConfig[]): void {
  console.log(`[AI] Initializing ${agents.length} agents...`);

  agents.forEach((config, index) => {
    const runtime: AgentRuntime = {
      config,
      systemPrompt: buildSystemPrompt(config),
      messages: [
        {
          role: 'user',
          content: 'The simulation has started. Look around, decide what to do, and take action using the tools available to you. You MUST use at least one tool (like move_to_region) on every turn.',
        },
      ],
      memoryStore: new MemoryStore(),
      emotionState: new EmotionState(),
      relationshipState: new RelationshipState(),
      running: true,
    };

    agentRuntimes.set(config.id, runtime);

    // Stagger initial starts so we don't flood the API
    const delay = 3000 + index * 2000;
    console.log(`[AI] ${config.id} (${config.name}): First tick in ${delay / 1000}s`);
    setTimeout(() => tickAgent(config.id), delay);
  });
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
function getAgentRegion(agentId: string): string {
  if (!bridgeFns) return 'unknown';
  const agent = useAgentsStore.getState().getAgent(agentId);
  if (!agent) return 'unknown';

  const regions = bridgeFns.getRegions();
  for (const region of regions) {
    if (
      agent.x >= region.x &&
      agent.x <= region.x + region.width &&
      agent.y >= region.y &&
      agent.y <= region.y + region.height
    ) {
      return region.label;
    }
  }
  return 'unknown';
}

/** Export all agent messages as JSONL for analysis. */
export function exportMessagesAsJSONL(): string {
  const allMessages: Array<Record<string, unknown>> = [];
  const agentsStore = useAgentsStore.getState();

  for (const [agentId, runtime] of agentRuntimes) {
    const agent = agentsStore.getAgent(agentId);
    const currentRegion = getAgentRegion(agentId);

    for (const msg of runtime.messages) {
      allMessages.push({
        agentId,
        agentName: runtime.config.name,
        agentRole: runtime.config.role,
        currentRegion,
        x: agent?.x,
        y: agent?.y,
        role: msg.role,
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        timestamp: Date.now(),
      });
    }
  }

  for (const session of useChatsStore.getState().getAllSessions()) {
    for (const msg of session.messages) {
      const agentRegion = getAgentRegion(msg.id);
      allMessages.push({
        agentId: msg.id,
        agentName: msg.name,
        currentRegion: agentRegion,
        role: 'chat',
        content: msg.content,
        timestamp: msg.timestamp,
        chatId: session.id,
        chatParticipants: session.participants.map((pid) => agentsStore.getAgent(pid)?.name ?? pid),
      });
    }
  }

  return allMessages.map((m) => JSON.stringify(m)).join('\n');
}
