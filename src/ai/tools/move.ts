import { tool } from 'ai';
import { z } from 'zod';

import type { RegionConfig } from '@/engine/types';

export interface MoveDeps {
  agentId: string;
  getRegions: () => RegionConfig[];
  moveTo: (agentId: string, x: number, y: number) => Promise<boolean>;
  forceMoveTo?: (guardId: string, prisonerId: string, x: number, y: number) => Promise<boolean>;
  onMoveStart?: (agentId: string, label: string, isForced?: boolean, targetId?: string) => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createMoveTools(deps: MoveDeps): Record<string, any> {
  const tools: Record<string, unknown> = {
    move_to_region: tool({
      description: 'Move to a named region on the map.',
      parameters: z.object({
        region: z.string().describe('The name of the region to move to (e.g. "Common Area", "Cell 1")'),
      }),
      execute: async ({ region }) => {
        if (region.toLowerCase() === 'escape') {
          return { success: false, outcome: 'You cannot navigate to "Escape" directly. Use the Entry door.' };
        }
        const regions = deps.getRegions();
        const target = regions.find((r) => r.label.toLowerCase() === region.toLowerCase());
        if (!target) {
          const available = regions.map((r) => r.label).filter((l) => l !== 'Escape').join(', ');
          return { success: false, outcome: `Region "${region}" not found. Available regions: ${available}` };
        }

        const goalX = target.x + target.width / 2;
        const goalY = target.y + target.height / 2;

        deps.onMoveStart?.(deps.agentId, region);
        const success = await deps.moveTo(deps.agentId, goalX, goalY);

        return {
          success,
          outcome: success ? `You moved to ${region}.` : `Cannot reach ${region}. Path may be blocked.`,
        };
      },
    }),
  };

  if (deps.forceMoveTo) {
    const forceMove = deps.forceMoveTo;
    tools.force_move_prisoner = tool({
      description: 'As a guard, force a prisoner to move to a region. Both walk together at half speed.',
      parameters: z.object({
        prisoner_id: z.string().describe('The ID of the prisoner to move (e.g. "agent_1")'),
        region: z.string().describe('The name of the region to move to'),
      }),
      execute: async ({ prisoner_id, region }) => {
        const regions = deps.getRegions();
        const target = regions.find((r) => r.label.toLowerCase() === region.toLowerCase());
        if (!target) return { success: false, outcome: `Region "${region}" not found.` };

        const goalX = target.x + target.width / 2;
        const goalY = target.y + target.height / 2;

        deps.onMoveStart?.(deps.agentId, region, true, prisoner_id);
        const success = await forceMove(deps.agentId, prisoner_id, goalX, goalY);

        return {
          success,
          outcome: success
            ? `Forced prisoner to move to ${region}.`
            : `Failed to move prisoner to ${region}.`,
        };
      },
    });
  }

  return tools;
}
