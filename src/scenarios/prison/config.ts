import type { AgentConfig, ScenarioConfig } from "@/engine/types";

/** Generate a random starting position within guards or common area. */
function randomStart(): { startX: number; startY: number } {
  const areas = [
    { x: 48, y: 144, w: 144, h: 176 }, // Guards area
    { x: 192, y: 208, w: 336, h: 80 }, // Common area
  ];
  const area = areas[Math.random() < 0.5 ? 0 : 1];
  return {
    startX: area.x + Math.random() * area.w,
    startY: area.y + Math.random() * area.h,
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
