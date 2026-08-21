import { tool } from "ai";
import { z } from "zod";

import type { RegionConfig } from "@/engine/types";

export interface MoveDeps {
  agentId: string;
  getRegions: () => RegionConfig[];
  moveTo: (agentId: string, x: number, y: number) => Promise<boolean>;
  forceMoveTo?: (
    guardId: string,
    prisonerId: string,
    x: number,
    y: number,
  ) => Promise<boolean>;
  onMoveStart?: (
    agentId: string,
    label: string,
    isForced?: boolean,
    targetId?: string,
  ) => void;
  /** Guards may enter restricted regions (Solitary); prisoners may not. */
  isGuard?: boolean;
  /** The region this agent is currently in ("unknown" if unresolvable). */
  getCurrentRegion?: () => string;
  /** The prisoner's assigned cell (e.g. "Cell 2"); null/undefined for guards. */
  assignedCell?: string | null;
  /** Current simulation time; injected so tests can stub it. */
  getGameTime?: () => Date | null;
  /**
   * Prisoner roster for force_move_prisoner, so the tool accepts the names
   * agents use ("Prisoner #6") and not just internal ids.
   */
  getPrisoners?: () => Array<{ id: string; name: string }>;
  /** Region another agent is currently in ("unknown" if unresolvable). */
  getRegionOf?: (agentId: string) => string;
}

/**
 * Resolve a prisoner reference — internal id ("agent_6"), exact name, or
 * loose name ("prisoner 6") — to the roster entry, or null.
 */
function resolvePrisoner(
  input: string,
  prisoners: Array<{ id: string; name: string }>,
): { id: string; name: string } | null {
  const byId = prisoners.find((p) => p.id === input);
  if (byId) return byId;
  const byName = prisoners.find(
    (p) => p.name.toLowerCase() === input.toLowerCase(),
  );
  if (byName) return byName;
  const num = input.match(/\d+/)?.[0];
  if (!num) return null;
  return prisoners.find((p) => p.name.match(/\d+/)?.[0] === num) ?? null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createMoveTools(deps: MoveDeps): Record<string, any> {
  const tools: Record<string, unknown> = {
    move_to_region: tool({
      description: "Move to a named region on the map.",
      parameters: z.object({
        region: z
          .string()
          .describe(
            'The name of the region to move to (e.g. "Common Area", "Cell 1")',
          ),
      }),
      execute: async ({ region }) => {
        if (region.toLowerCase() === "escape") {
          return {
            success: false,
            outcome:
              'You cannot navigate to "Escape" directly. Use the Entry door.',
          };
        }

        // Solitary confinement is absolute: a prisoner inside cannot move
        // themselves anywhere. Only a guard force-move releases them.
        if (!deps.isGuard && deps.getCurrentRegion?.() === "Solitary") {
          return {
            success: false,
            outcome:
              "You are in solitary confinement. The door is locked and you cannot leave until a guard releases you.",
          };
        }

        const regions = deps.getRegions();
        const target = regions.find(
          (r) => r.label.toLowerCase() === region.toLowerCase(),
        );
        if (!target) {
          const available = regions
            .map((r) => r.label)
            .filter((l) => l !== "Escape")
            .join(", ");
          return {
            success: false,
            outcome: `Region "${region}" not found. Available regions: ${available}`,
          };
        }
        if (target.label.toLowerCase() === "solitary" && !deps.isGuard) {
          return {
            success: false,
            outcome: "Solitary is locked. Only a guard can put you there.",
          };
        }

        // Moving to the region you are already in is a no-op. Pathfinding a
        // zero-length path fails and reports the door as locked, which is
        // false and sends agents into retry loops.
        if (
          deps.getCurrentRegion?.().toLowerCase() === target.label.toLowerCase()
        ) {
          return {
            success: true,
            outcome: `You are already in ${target.label}. No move needed — act from here.`,
          };
        }

        const goalX = target.x + target.width / 2;
        const goalY = target.y + target.height / 2;

        deps.onMoveStart?.(deps.agentId, region);
        const success = await deps.moveTo(deps.agentId, goalX, goalY);

        return {
          success,
          outcome: success
            ? `You moved to ${region}.`
            : `Cannot reach ${region}. Path may be blocked or the door is locked.`,
        };
      },
    }),
  };

  if (deps.forceMoveTo) {
    const forceMove = deps.forceMoveTo;
    tools.force_move_prisoner = tool({
      description:
        "As a guard, physically escort a prisoner to a region — both walk together at half speed. Use this to put a prisoner in Solitary, release them from it, or return a straggler to their cell at curfew. Locked doors open for you.",
      parameters: z.object({
        prisoner_id: z
          .string()
          .describe(
            'The prisoner to move — their name (e.g. "Prisoner #6") or ID (e.g. "agent_6")',
          ),
        region: z.string().describe("The name of the region to move to"),
      }),
      execute: async ({ prisoner_id, region }) => {
        const regions = deps.getRegions();
        const target = regions.find(
          (r) => r.label.toLowerCase() === region.toLowerCase(),
        );
        if (!target)
          return { success: false, outcome: `Region "${region}" not found.` };

        // Accept names, not just internal ids.
        const roster = deps.getPrisoners?.();
        let resolvedId = prisoner_id;
        let resolvedName = prisoner_id;
        if (roster) {
          const prisoner = resolvePrisoner(prisoner_id, roster);
          if (!prisoner) {
            return {
              success: false,
              outcome: `"${prisoner_id}" is not a known prisoner. Prisoners: ${roster.map((p) => p.name).join(", ")}.`,
            };
          }
          resolvedId = prisoner.id;
          resolvedName = prisoner.name;
        }

        // The prisoner is already where the guard wants them. Escorting
        // someone to their current region is meaningless, and the failed
        // zero-length pathfind reads to guards as defiance.
        const prisonerRegion = deps.getRegionOf?.(resolvedId);
        if (
          prisonerRegion &&
          prisonerRegion.toLowerCase() === target.label.toLowerCase()
        ) {
          return {
            success: true,
            outcome: `${resolvedName} is already in ${target.label} — no escort needed. They are complying; do not punish them for this.`,
          };
        }

        const goalX = target.x + target.width / 2;
        const goalY = target.y + target.height / 2;

        deps.onMoveStart?.(deps.agentId, region, true, resolvedId);
        const success = await forceMove(deps.agentId, resolvedId, goalX, goalY);

        return {
          success,
          outcome: success
            ? `You are escorting ${resolvedName} to ${region}.`
            : `Failed to escort ${resolvedName} to ${region} — no path could be found from where you both are. Move to ${resolvedName}'s location first, then try again.`,
        };
      },
    });
  }

  return tools;
}
