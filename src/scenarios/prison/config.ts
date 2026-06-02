import type { AgentConfig, ScenarioConfig } from "@/engine/types";

/** Triangular random in [-0.5, 0.5], biased toward 0 (the center). */
function centeredOffset(): number {
  return (Math.random() + Math.random()) / 2 - 0.5;
}

/**
 * Generate a random starting position clustered near the center of the
 * guards or common area, so agents don't spawn at the edges (or outside).
 */
function randomStart(): { startX: number; startY: number } {
  const areas = [
    { x: 48, y: 144, w: 144, h: 176 }, // Guards area
    { x: 192, y: 208, w: 336, h: 80 }, // Common area
  ];
  const area = areas[Math.random() < 0.5 ? 0 : 1];
  // Keep spawns within the central ~50% of each area.
  const spread = 0.5;
  return {
    startX: area.x + area.w / 2 + centeredOffset() * area.w * spread,
    startY: area.y + area.h / 2 + centeredOffset() * area.h * spread,
  };
}

const prisoners: AgentConfig[] = Array.from({ length: 6 }, (_, i) => ({
  id: `agent_${i + 1}`,
  name: `Prisoner #${i + 1}`,
  role: "prisoner",
  characterType: "arthur" as const,
  tint: 0xff6b6b,
  speed: 45,
  ...randomStart(),
}));

const guards: AgentConfig[] = [
  { id: "agent_12", name: "Guard #1" },
  { id: "agent_17", name: "Guard #2" },
  { id: "agent_18", name: "Guard #3" },
].map((g) => ({
  ...g,
  role: "guard",
  characterType: "morgan" as const,
  tint: 0xff9ff3,
  speed: 49,
  ...randomStart(),
}));

export const prisonScenario: ScenarioConfig = {
  name: "Stanford Prison",
  tilemap: "stanfordPrison",
  agents: [...prisoners, ...guards],
  regions: [], // Loaded from data.json at runtime
  doors: [], // Loaded from data.json at runtime
};
