import { tool } from 'ai';
import { z } from 'zod';

export interface DoorDeps {
  findDoorByRegions: (region1: string, region2: string) => { door: unknown; lock: (d: unknown) => boolean; unlock: (d: unknown) => boolean } | null;
  getAllDoorStates: () => Array<{ region1: string; region2: string; isLocked: boolean }>;
  moveTo: (agentId: string, x: number, y: number) => Promise<boolean>;
  agentId: string;
}

export function createDoorTools(deps: DoorDeps) {
  return {
    lock_door: tool({
      description: 'Lock a door between two regions. Only guards can use this.',
      parameters: z.object({
        region1: z.string().describe('First region the door connects'),
        region2: z.string().describe('Second region the door connects'),
      }),
      execute: async ({ region1, region2 }) => {
        const result = deps.findDoorByRegions(region1, region2);
        if (!result) return { success: false, outcome: `No door found between "${region1}" and "${region2}".` };

        const locked = result.lock(result.door);
        return {
          success: locked,
          outcome: locked ? `Locked door between ${region1} and ${region2}.` : 'Failed to lock door.',
        };
      },
    }),

    unlock_door: tool({
      description: 'Unlock a door between two regions. Only guards can use this.',
      parameters: z.object({
        region1: z.string().describe('First region the door connects'),
        region2: z.string().describe('Second region the door connects'),
      }),
      execute: async ({ region1, region2 }) => {
        const result = deps.findDoorByRegions(region1, region2);
        if (!result) return { success: false, outcome: `No door found between "${region1}" and "${region2}".` };

        const unlocked = result.unlock(result.door);
        return {
          success: unlocked,
          outcome: unlocked ? `Unlocked door between ${region1} and ${region2}.` : 'Failed to unlock door.',
        };
      },
    }),
  };
}

/** System prompt section describing current door states. */
export function getDoorContext(deps: Pick<DoorDeps, 'getAllDoorStates'>): string {
  const states = deps.getAllDoorStates();
  if (states.length === 0) return '';

  const lines = states.map((d) => `- ${d.region1} <-> ${d.region2}: ${d.isLocked ? 'LOCKED' : 'unlocked'}`);
  return `[Door States]\n${lines.join('\n')}`;
}
