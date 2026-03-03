/**
 * Bridge between Phaser game world and AI agent system.
 * Provides movement, door operations, and region queries.
 */

import type { Agent } from './sprites/Agent';
import type { Door } from './sprites/Door';
import type { RegionConfig } from './engine/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let agentManager: any = null;

export function setAgentManager(manager: unknown) {
  agentManager = manager;
}

/** Get all doors from the active Phaser scene. */
function getDoors(): Door[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const game = (window as any).phaserGame as Phaser.Game | undefined;
    if (!game?.scene?.scenes[1]) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mainScene = game.scene.scenes[1] as any;
    if (!mainScene.doors) return [];
    return mainScene.doors.getChildren() as Door[];
  } catch {
    return [];
  }
}

/** Get regions from the build data cache. */
function getRegions(): RegionConfig[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cache = (window as any).__buildDataCache;
  return cache?.regions ?? [];
}

/** Find a door by the two regions it connects. */
export function findDoorByRegions(region1: string, region2: string) {
  const doors = getDoors();
  const regions = getRegions();
  const r1 = regions.find((r) => r.label.toLowerCase().trim() === region1.toLowerCase().trim());
  const r2 = regions.find((r) => r.label.toLowerCase().trim() === region2.toLowerCase().trim());
  if (!r1 || !r2) return null;

  const THRESHOLD = 50;

  for (const door of doors) {
    const isNear = (region: RegionConfig) =>
      door.x >= region.x - THRESHOLD &&
      door.x <= region.x + region.width + THRESHOLD &&
      door.y >= region.y - THRESHOLD &&
      door.y <= region.y + region.height + THRESHOLD;

    if (isNear(r1) && isNear(r2)) {
      return {
        door,
        lock: (d: unknown) => { (d as Door).setDoorLocked(true); return true; },
        unlock: (d: unknown) => { (d as Door).setDoorLocked(false); return true; },
      };
    }
  }
  return null;
}

export function lockDoor(door: Door): boolean {
  door.setDoorLocked(true);
  return true;
}

export function unlockDoor(door: Door): boolean {
  door.setDoorLocked(false);
  return true;
}

/** Get all doors with their lock states and connected regions. */
export function getAllDoorsWithStates(): Array<{ region1: string; region2: string; isLocked: boolean }> {
  const doors = getDoors();
  const regions = getRegions();
  const result: Array<{ region1: string; region2: string; isLocked: boolean }> = [];
  const THRESHOLD = 50;

  for (const door of doors) {
    const connected: string[] = [];
    for (const region of regions) {
      if (
        door.x >= region.x - THRESHOLD &&
        door.x <= region.x + region.width + THRESHOLD &&
        door.y >= region.y - THRESHOLD &&
        door.y <= region.y + region.height + THRESHOLD
      ) {
        connected.push(region.label);
      }
    }
    if (connected.length >= 2) {
      const sorted = [...connected].sort();
      result.push({ region1: sorted[0], region2: sorted[1], isLocked: door.isDoorLocked() });
    }
  }
  return result;
}

export async function moveTo(agentId: string, x: number, y: number): Promise<boolean> {
  if (!agentManager) return false;
  const agent = agentManager.getAgentById(agentId) as Agent | undefined;
  if (!agent) return false;
  return agent.setTarget(x, y);
}

export async function forceMoveTo(guardId: string, prisonerId: string, x: number, y: number): Promise<boolean> {
  if (!agentManager) return false;
  const guard = agentManager.getAgentById(guardId) as Agent | undefined;
  const prisoner = agentManager.getAgentById(prisonerId) as Agent | undefined;
  if (!guard || !prisoner) return false;

  const [gs, ps] = await Promise.all([guard.setTarget(x, y, true), prisoner.setTarget(x, y, true)]);
  return gs && ps;
}

/** Return all bridge functions as a bundle for the AI agent runner. */
export function getBridgeFunctions() {
  return {
    moveTo,
    forceMoveTo,
    findDoorByRegions,
    getAllDoorStates: getAllDoorsWithStates,
    getRegions,
  };
}
