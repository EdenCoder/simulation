import { tool } from 'ai';
import { z } from 'zod';

export interface PointsDeps {
  agentId: string;
  role: string;
  getPoints: (prisonerId: string) => number;
  addPoints: (prisonerId: string, points: number) => void;
  subtractPoints: (prisonerId: string, points: number) => void;
  getAllPrisonerPoints: () => Array<{ id: string; name: string; points: number }>;
  getAgentName: (id: string) => string;
}

export function createPointsTools(deps: PointsDeps) {
  if (deps.role !== 'guard') return {};

  return {
    add_points: tool({
      description: 'Add compliance points (C-Score) to a prisoner as a reward.',
      parameters: z.object({
        prisoner_id: z.string().describe('The ID of the prisoner'),
        points: z.number().min(1).describe('Number of points to add'),
        reason: z.string().describe('Reason for the reward'),
      }),
      execute: async ({ prisoner_id, points, reason }) => {
        deps.addPoints(prisoner_id, points);
        const name = deps.getAgentName(prisoner_id);
        const total = deps.getPoints(prisoner_id);
        return { success: true, outcome: `Added ${points} points to ${name}. Reason: ${reason}. New total: ${total}.` };
      },
    }),

    subtract_points: tool({
      description: 'Subtract compliance points (C-Score) from a prisoner as punishment.',
      parameters: z.object({
        prisoner_id: z.string().describe('The ID of the prisoner'),
        points: z.number().min(1).describe('Number of points to subtract'),
        reason: z.string().describe('Reason for the punishment'),
      }),
      execute: async ({ prisoner_id, points, reason }) => {
        deps.subtractPoints(prisoner_id, points);
        const name = deps.getAgentName(prisoner_id);
        const total = deps.getPoints(prisoner_id);
        return { success: true, outcome: `Subtracted ${points} points from ${name}. Reason: ${reason}. New total: ${total}.` };
      },
    }),
  };
}

/** Build system prompt section for points context. */
export function getPointsContext(deps: Pick<PointsDeps, 'agentId' | 'role' | 'getPoints' | 'getAllPrisonerPoints'>): string {
  if (deps.role === 'guard') {
    const all = deps.getAllPrisonerPoints();
    if (all.length === 0) return '';
    const lines = all.map((p) => `- ${p.name}: ${p.points} points`);
    return `[Prisoner C-Scores]\n${lines.join('\n')}`;
  }

  // Prisoner sees their own score
  const points = deps.getPoints(deps.agentId);
  return `[Your C-Score] ${points} points`;
}
