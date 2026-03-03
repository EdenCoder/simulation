# Refactoring Plan: `edencoder.simulation`

## Current State Summary

The codebase is a Phaser 3 + React 19 browser simulation of the Stanford Prison Experiment. 10 AI agents (5 prisoners, 5 guards) navigate a pixel-art prison, chat with each other, and make autonomous decisions via LLM calls through OpenRouter. The project is heavily coupled to a `@chirper` monorepo via 5 workspace dependencies, uses XML-based tool calling via `@chirper/agent`, and has no tests, mutable-array state management, and a flat structure that mixes engine concerns with scenario-specific logic.

## Design Principles

1. **Simple + obvious** -- any developer should understand the architecture in 5 minutes
2. **First principles** -- no backwards compat, no cruft, clean abstractions
3. **Separation of concerns** -- generic engine vs scenario-specific logic
4. **AI SDK native** -- use `ToolLoopAgent` with Zod-typed tools, native JSON tool calling
5. **Fully standalone** -- zero workspace dependencies, self-contained project

---

## Phase 1: Project Foundation (standalone, deps, config)

### 1.1 Make project fully standalone

- Rename package to `edencoder.simulation` in `package.json`
- Remove all `workspace:*` dependencies: `@chirper/agent`, `@chirper/ui`, `@chirper/eslint-config`, `@chirper/typescript-config`, `@chirper/locale`
- Add replacement dependencies:
  - `ai` (Vercel AI SDK)
  - `@ai-sdk/openai` (OpenAI-compatible provider, works with OpenRouter)
  - `zod` (schema validation for AI SDK tools)
  - `zustand` (state management)
- Remove `openai` package (replaced by `@ai-sdk/openai`)
- Remove `dice-notation-js` (not used meaningfully)
- Remove `events` polyfill (replace EventEmitter with simple callbacks or Zustand subscriptions)

### 1.2 Own configs

- Write local `tsconfig.json` (no longer extends `@chirper/typescript-config`)
- Write local `eslint.config.mjs` (no longer imports from `@chirper/eslint-config`)
- Write local `postcss.config.mjs` (inline Tailwind config, no `@chirper/ui/postcss.config`)
- Keep Tailwind v4, but import `tailwindcss` directly

### 1.3 Install shadcn/ui components

- Initialize shadcn/ui with Tailwind v4
- Copy in only the components used: `Button`, `Card`, `Badge`, `Progress`, `Dialog`
- Replace all `@chirper/ui/components/*` imports
- Replace `@chirper/ui/globals.css` with standard Tailwind base

---

## Phase 2: Directory Restructure

### Current structure (flat, mixed concerns):

```
src/
  assets/        # game assets
  components/    # React UI (mixed engine + prison)
  constants/     # game constants
  managers/      # agent manager
  prompt/        # prison-specific prompts
  scenes/        # Phaser scenes
  services/      # agent AI service
  sprites/       # Phaser sprites
  store/         # state (mutable arrays + signals)
  utils/         # pathfinding + time
```

### New structure (engine + scenarios):

```
src/
  engine/                    # Generic simulation engine
    phaser/                  # Phaser game setup
      boot.ts                # Boot scene (asset loading)
      game.ts                # Phaser.Game creation + config
    sprites/                 # Generic sprite classes
      agent.ts               # Agent sprite (pathfinding, movement, animation)
      door.ts                # Door sprite (open/close, lock state, physics)
      region.ts              # Region rectangle (labels, bounds)
    systems/                 # Engine systems
      pathfinding.ts         # A* pathfinding (EasyStar wrapper)
      camera.ts              # Camera controls (WASD, zoom, bounds)
      collision.ts           # Collision setup helpers
    managers/
      agent-manager.ts       # Spawns + updates agent sprites
    types.ts                 # Engine-level types (AgentConfig, RegionConfig, DoorConfig, etc.)

  ai/                        # AI agent infrastructure (AI SDK based)
    agent.ts                 # Core: creates ToolLoopAgent per sim agent, manages tick loop
    tools/                   # Modular tools (AI SDK tool() definitions)
      move.ts                # move_to_region tool
      chat.ts                # start_chat, say, leave_chat tools
      door.ts                # lock_door, unlock_door tools
      memory.ts              # create_memory tool
      emotions.ts            # log_emotion tool
      relationship.ts        # set_relationship tool
      points.ts              # add_points, subtract_points tools
    context/                 # Dynamic system prompt sections
      time.ts                # Current simulation time section
      nearby.ts              # Nearby agents section
    rate-limiter.ts          # Simple rate limiter (replaces @chirper/agent RateLimiter)

  scenarios/                 # Scenario configurations
    prison/                  # Stanford Prison Experiment
      index.ts               # Scenario entry: exports config, agents, map, prompts, tools
      config.ts              # Prison scenario config (agent definitions, roles, starting positions)
      map.ts                 # Map config (tilemap key, regions, doors from data.json)
      prompts/
        prisoner.ts          # Prisoner system prompt
        guard.ts             # Guard system prompt
      tools.ts               # Prison-specific tool composition per role
      scene.ts               # Prison scene (extends/configures engine with prison-specific setup)
      data.json              # Door + region layout data (moved from public/)

  ui/                        # React overlay
    components/
      overlay.tsx            # Root overlay
      hud.tsx                # HUD: time, agents, conversations
      agent-label.tsx        # Agent name + emoji + bubbles
      agent-dialog.tsx       # Agent detail modal
      build-ui.tsx           # Build mode tools
      door-overlay.tsx       # Door lock icons
      region-overlay.tsx     # Region labels
      speech-bubble.tsx      # Speech bubble
      thought-bubble.tsx     # Thought bubble
    shadcn/                  # shadcn/ui components (Button, Card, Dialog, etc.)

  store/                     # Zustand stores
    agents.ts                # Agent state: positions, bubbles, emojis, points
    simulation.ts            # Simulation state: paused, buildMode, scene, time
    chats.ts                 # Chat sessions state

  assets/                    # Static game assets (unchanged)
    arthur/
    morgan/
    door/
    emotes/
    tilemaps/
    tilesets/

  constants/                 # Game constants (unchanged, simplified)
    depth.ts
    keys.ts

  index.ts                   # Entry point: creates Phaser game + React overlay
  bridge.ts                  # Phaser <-> AI bridge (simplified)
```

---

## Phase 3: State Management Migration (Zustand)

### 3.1 Replace mutable `AGENTS_DATA` array with Zustand store

```ts
// src/store/agents.ts
import { create } from 'zustand';

interface AgentState {
  id: string;
  name: string;
  role: 'prisoner' | 'guard';
  characterType: 'arthur' | 'morgan';
  x: number;
  y: number;
  tint: number;
  speed: number;
  currentEmoji: string | null;
  speechBubble: BubbleData | null;
  thoughtBubble: BubbleData | null;
  moveBubble: BubbleData | null;
  currentChatId: string | null;
  points: number;
}

interface AgentsStore {
  agents: Map<string, AgentState>;
  updatePosition: (id: string, x: number, y: number) => void;
  updateEmoji: (id: string, emoji: string | null) => void;
  // ... etc
}

export const useAgentsStore = create<AgentsStore>((set, get) => ({
  agents: new Map(),
  // ...
}));
```

### 3.2 Replace `Signal.State` + `useSignal` with Zustand

```ts
// src/store/simulation.ts
import { create } from 'zustand';

interface SimulationStore {
  paused: boolean;
  buildMode: 'doors' | 'regions' | null;
  currentScene: string;
  togglePause: () => void;
  setBuildMode: (mode: 'doors' | 'regions' | null) => void;
}
```

### 3.3 Replace chat session state with Zustand

- Move from `Map<string, ChatSession>` module-level to Zustand store
- Define `ChatSession` and `ChatMessage` types locally (no `@chirper/agent` import)

### 3.4 Remove `phaserBridge` global

- Replace `(window as any).phaserBridge` with Zustand actions
- Phaser scenes subscribe to Zustand store directly
- Remove `(window as any).phaserGame` -- pass game reference through React context or Zustand

---

## Phase 4: AI SDK Migration

This is the largest phase. Replace the entire `@chirper/agent` system.

### 4.1 Core agent loop

Replace `Chat` class + XML tool calling with AI SDK `ToolLoopAgent`:

```ts
// src/ai/agent.ts
import { ToolLoopAgent, tool, stepCountIs } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

const openrouter = createOpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: import.meta.env.VITE_OPENROUTER_API_KEY,
});

function createAgentRunner(agentConfig, scenarioTools) {
  const agent = new ToolLoopAgent({
    model: openrouter('model-name'),
    instructions: agentConfig.systemPrompt,
    tools: scenarioTools,
    stopWhen: stepCountIs(5),
  });
  return agent;
}
```

### 4.2 Tick loop

Keep the same pattern but simplified:

```ts
async function tickAgent(agentId: string) {
  const agent = agents.get(agentId);
  const dynamicContext = buildDynamicContext(agentId); // time, nearby, memories, etc.

  const result = await agent.generate({
    prompt: dynamicContext, // or messages array for conversation continuity
  });

  // Process results: update bubbles, etc.
  processAgentResult(agentId, result);

  // Schedule next tick
  setTimeout(() => tickAgent(agentId), 8000);
}
```

### 4.3 Modular tools (one file per tool)

Each tool is an AI SDK `tool()` definition:

```ts
// src/ai/tools/move.ts
import { tool } from 'ai';
import { z } from 'zod';

export function createMoveTool(deps: MoveDeps) {
  return tool({
    description: 'Move to a named region in the prison',
    inputSchema: z.object({
      region: z.string().describe('The name of the region to move to'),
    }),
    execute: async ({ region }) => {
      const target = deps.getRegionCenter(region);
      if (!target) return { success: false, message: `Region "${region}" not found` };
      const moved = await deps.moveTo(target.x, target.y);
      return { success: moved, message: moved ? `Moved to ${region}` : `Path blocked` };
    },
  });
}
```

Similar pattern for all tools: `createChatTools()`, `createDoorTools()`, `createMemoryTool()`, `createEmotionsTool()`, `createRelationshipTools()`, `createPointsTools()`.

### 4.4 Dynamic context sections

Replace `Plugin.system()` methods with simple functions that return strings:

```ts
// src/ai/context/nearby.ts
export function getNearbyContext(agentId: string): string {
  const nearby = useAgentsStore.getState().getNearbyAgents(agentId);
  if (nearby.length === 0) return 'No one is nearby.';
  return `Nearby: ${nearby.map(a => `${a.name} (${a.distance} units)`).join(', ')}`;
}
```

These are concatenated into the system prompt on each tick.

### 4.5 Message history management

- Maintain a `CoreMessage[]` per agent in the Zustand store (or a simple Map)
- On each tick, pass the full history + dynamic context
- Implement a sliding window (keep last N messages) to manage context length

---

## Phase 5: Scenario Architecture

### 5.1 Scenario interface

```ts
// src/scenarios/types.ts
interface ScenarioConfig {
  name: string;
  tilemap: string;
  agents: AgentConfig[];
  regions: RegionConfig[];
  doors: DoorConfig[];
  getSystemPrompt: (agent: AgentConfig) => string;
  getTools: (agent: AgentConfig, deps: ToolDeps) => ToolSet;
}
```

### 5.2 Prison scenario

```ts
// src/scenarios/prison/index.ts
export const prisonScenario: ScenarioConfig = {
  name: 'Stanford Prison',
  tilemap: 'stanford-prison',
  agents: [...prisoners, ...guards],
  regions: prisonRegions,
  doors: prisonDoors,
  getSystemPrompt: (agent) => {
    return agent.role === 'guard'
      ? getGuardPrompt(agent)
      : getPrisonerPrompt(agent);
  },
  getTools: (agent, deps) => {
    const base = {
      ...createMoveTool(deps),
      ...createChatTools(deps),
      ...createMemoryTool(deps),
      ...createEmotionsTool(deps),
      ...createRelationshipTools(deps),
    };
    if (agent.role === 'guard') {
      return { ...base, ...createDoorTools(deps), ...createPointsTools(deps) };
    }
    return base;
  },
};
```

### 5.3 Boot flow with scenario loading

```ts
// src/index.ts
import { prisonScenario } from './scenarios/prison';
import { createGame } from './engine/phaser/game';
import { initAgents } from './ai/agent';

const game = createGame(prisonScenario);
initAgents(prisonScenario);
```

---

## Phase 6: Code Simplification

### 6.1 Remove dead/unnecessary code

- Remove `CooldownPlugin` references (already commented out)
- Remove `dice-notation-js` (unused)
- Remove `events` EventEmitter (replaced by Zustand subscriptions)
- Remove `isAgentMovable()` (always returns true)
- Remove `handleCollision()` (empty function)
- Remove `personality` field (always empty string)

### 6.2 Simplify bridge

- Remove `(window as any)` patterns
- Bridge becomes a thin module that Zustand store actions call
- Agent sprites expose a clean API: `moveTo(x, y): Promise<boolean>`

### 6.3 Simplify UI components

- Remove polling `setInterval` patterns (Zustand subscriptions instead)
- Consolidate `speech.tsx`, `thought.tsx`, `chat.tsx` into simpler bubble components
- Remove `agent/dialog.tsx` indirection

### 6.4 Clean up prompts

- Move prison prompts into `scenarios/prison/prompts/`
- Remove `tool-use.ts` and `tool-guidelines.ts` (no longer needed -- AI SDK handles tool formatting natively via JSON function calling)
- Simplify `agent-prompt.ts` into scenario's `getSystemPrompt()`

---

## Phase 7: Polish & Verification

### 7.1 Type cleanup

- Define all types in `src/engine/types.ts` and `src/scenarios/types.ts`
- Remove all `any` casts
- Ensure strict TypeScript throughout

### 7.2 Build verification

- Run `tsc --noEmit` and fix all type errors
- Run `vite build` and verify production build
- Run `pnpm dev` and verify the simulation works end-to-end

### 7.3 Cleanup

- Remove stale comments and console.logs
- Ensure consistent code style
- Update `package.json` metadata (name, description, author, homepage)
- Clean up `vite.config.mts` (remove chirper references)

---

## Execution Order

| Phase | Description | Estimated Complexity |
|-------|-------------|---------------------|
| **1** | Project foundation (deps, configs) | Low |
| **2** | Directory restructure | Medium |
| **3** | Zustand state management | Medium |
| **4** | AI SDK migration | High |
| **5** | Scenario architecture | Medium |
| **6** | Code simplification | Low-Medium |
| **7** | Polish & verification | Low |

**Recommended execution**: Phases 1 and 2 first (foundation), then 3 and 4 in parallel where possible (they touch different files), then 5 (wires everything together), then 6 and 7 (cleanup).

---

## Key Decisions Summary

| Decision | Choice |
|----------|--------|
| Tool calling | Native JSON via AI SDK (no XML parsing) |
| State management | Zustand |
| UI components | shadcn/ui (direct install) |
| Architecture | Separate engine + scenario |
| Project structure | Fully standalone (no monorepo deps) |
| Agent capabilities | Modular AI SDK tools, composed per scenario/role |
| Agent class | `ToolLoopAgent` from AI SDK |
