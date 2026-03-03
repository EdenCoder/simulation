/**
 * Core engine types shared across the simulation.
 */

/** Configuration for a single agent in a scenario. */
export interface AgentConfig {
  id: string;
  name: string;
  role: string;
  characterType: 'arthur' | 'morgan';
  tint: number;
  speed: number;
  startX: number;
  startY: number;
}

/** Configuration for a named region on the map. */
export interface RegionConfig {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  color: number;
}

/** Configuration for a door on the map. */
export interface DoorConfig {
  x: number;
  y: number;
  type: 'horizontal' | 'vertical';
  position: 'left' | 'right';
  isOpen: boolean;
  isLocked: boolean;
}

/** Full scenario configuration that the engine consumes. */
export interface ScenarioConfig {
  name: string;
  tilemap: string;
  agents: AgentConfig[];
  regions: RegionConfig[];
  doors: DoorConfig[];
}
