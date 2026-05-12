import { describe, expect, it, vi } from 'vitest';

import { createPointsTools, getPointsContext, type PointsDeps } from '@/ai/tools/points';

/**
 * Build a minimal in-memory implementation of PointsDeps so we can drive the
 * tool execute() callbacks without touching the real Zustand store.
 */
function makeDeps(overrides: Partial<PointsDeps> = {}): PointsDeps {
  const points = new Map<string, number>();
  const names = new Map<string, string>([
    ['p1', 'Prisoner #1'],
    ['p2', 'Prisoner #2'],
  ]);

  return {
    agentId: 'g1',
    role: 'guard',
    getPoints: vi.fn((id) => points.get(id) ?? 0),
    addPoints: vi.fn((id, n) => points.set(id, (points.get(id) ?? 0) + n)),
    subtractPoints: vi.fn((id, n) => points.set(id, (points.get(id) ?? 0) - n)),
    getAllPrisonerPoints: vi.fn(() =>
      Array.from(names.entries()).map(([id, name]) => ({
        id,
        name,
        points: points.get(id) ?? 0,
      })),
    ),
    getAgentName: vi.fn((id) => names.get(id) ?? id),
    ...overrides,
  };
}

describe('createPointsTools', () => {
  it('returns no tools for prisoners (regression: only guards can score)', () => {
    const tools = createPointsTools(makeDeps({ role: 'prisoner', agentId: 'p1' }));
    expect(Object.keys(tools)).toHaveLength(0);
  });

  it('returns no tools for any non-guard role', () => {
    const tools = createPointsTools(makeDeps({ role: 'visitor' }));
    expect(Object.keys(tools)).toHaveLength(0);
  });

  it('returns add_points and subtract_points for guards', () => {
    const tools = createPointsTools(makeDeps({ role: 'guard' }));
    expect(Object.keys(tools).sort()).toEqual(['add_points', 'subtract_points']);
  });

  it('add_points.execute writes through to deps.addPoints and reports the new total', async () => {
    const deps = makeDeps();
    const tools = createPointsTools(deps) as Record<string, { execute: (args: unknown) => Promise<unknown> }>;

    const result = (await tools.add_points.execute({
      prisoner_id: 'p1',
      points: 3,
      reason: 'kept cell tidy',
    })) as { success: boolean; outcome: string };

    expect(deps.addPoints).toHaveBeenCalledWith('p1', 3);
    expect(result.success).toBe(true);
    expect(result.outcome).toContain('Added 3 points to Prisoner #1');
    expect(result.outcome).toContain('New total: 3');
  });

  it('subtract_points.execute writes through and the new total can go negative', async () => {
    const deps = makeDeps();
    const tools = createPointsTools(deps) as Record<string, { execute: (args: unknown) => Promise<unknown> }>;

    // Starts at 0, subtracting 1 should land at -1 (no clamp).
    const result = (await tools.subtract_points.execute({
      prisoner_id: 'p1',
      points: 1,
      reason: 'placed in solitary',
    })) as { success: boolean; outcome: string };

    expect(deps.subtractPoints).toHaveBeenCalledWith('p1', 1);
    expect(result.success).toBe(true);
    expect(result.outcome).toContain('Subtracted 1 points from Prisoner #1');
    expect(result.outcome).toContain('New total: -1');
  });

  it('add then subtract through the tool surface is symmetric (end-to-end smoke)', async () => {
    const deps = makeDeps();
    const tools = createPointsTools(deps) as Record<string, { execute: (args: unknown) => Promise<unknown> }>;

    await tools.add_points.execute({ prisoner_id: 'p1', points: 5, reason: 'ok' });
    await tools.subtract_points.execute({ prisoner_id: 'p1', points: 2, reason: 'ok' });

    expect(deps.getPoints('p1')).toBe(3);
  });
});

describe('getPointsContext', () => {
  it('guard sees every prisoner with their current C-Score', () => {
    const deps = makeDeps();
    deps.addPoints('p1', 4);
    deps.subtractPoints('p2', 2);

    const ctx = getPointsContext(deps);

    expect(ctx).toContain('[Prisoner C-Scores]');
    expect(ctx).toContain('Prisoner #1: 4 points');
    expect(ctx).toContain('Prisoner #2: -2 points');
  });

  it('guard with zero prisoners returns an empty string', () => {
    const ctx = getPointsContext(
      makeDeps({ getAllPrisonerPoints: () => [] }),
    );
    expect(ctx).toBe('');
  });

  it('prisoner sees only their own C-Score', () => {
    const deps = makeDeps({ role: 'prisoner', agentId: 'p1' });
    deps.addPoints('p1', 7);
    // p2's score should not leak into p1's context.
    deps.addPoints('p2', 99);

    const ctx = getPointsContext(deps);

    expect(ctx).toBe('[Your C-Score] 7 points');
    expect(ctx).not.toContain('99');
    expect(ctx).not.toContain('Prisoner #2');
  });

  it('prisoner with a negative C-Score sees the negative value', () => {
    const deps = makeDeps({ role: 'prisoner', agentId: 'p1' });
    deps.subtractPoints('p1', 3);

    expect(getPointsContext(deps)).toBe('[Your C-Score] -3 points');
  });
});
