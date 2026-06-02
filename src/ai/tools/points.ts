/**
 * C-Score (compliance points) helpers.
 *
 * C-Score changes are applied inline via the `say` chat tool's `cscore`
 * parameter (see ./chat.ts) rather than through standalone tools, so the
 * guard's announcement and the actual score change happen in a single call.
 * This module only builds the system-prompt context that shows current
 * scores.
 */
export interface PointsContextDeps {
  agentId: string;
  role: string;
  getPoints: (prisonerId: string) => number;
  getAllPrisonerPoints: () => Array<{ id: string; name: string; points: number }>;
}

/** Build system prompt section for points context. */
export function getPointsContext(deps: PointsContextDeps): string {
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
