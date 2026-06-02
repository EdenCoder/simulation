import { describe, expect, it, vi } from 'vitest';

import { getPointsContext, type PointsContextDeps } from '@/ai/tools/points';

/**
 * Build a minimal in-memory implementation of PointsContextDeps so we can
 * exercise the system-prompt context builder without touching the real
 * Zustand store.
 */
function makeDeps(overrides: Partial<PointsContextDeps> = {}): PointsContextDeps {
  const points = new Map<string, number>();
  const names = new Map<string, string>([
    ['p1', 'Prisoner #1'],
    ['p2', 'Prisoner #2'],
  ]);

  return {
    agentId: 'g1',
    role: 'guard',
    getPoints: vi.fn((id) => points.get(id) ?? 0),
    getAllPrisonerPoints: vi.fn(() =>
      Array.from(names.entries()).map(([id, name]) => ({
        id,
        name,
        points: points.get(id) ?? 0,
      })),
    ),
    // Test helpers piggy-backing on the same in-memory map.
    ...overrides,
  };
}

describe('getPointsContext', () => {
  it('guard sees every prisoner with their current C-Score', () => {
    const scores = new Map<string, number>([
      ['p1', 4],
      ['p2', -2],
    ]);
    const deps = makeDeps({
      getAllPrisonerPoints: () => [
        { id: 'p1', name: 'Prisoner #1', points: scores.get('p1') ?? 0 },
        { id: 'p2', name: 'Prisoner #2', points: scores.get('p2') ?? 0 },
      ],
    });

    const ctx = getPointsContext(deps);

    expect(ctx).toContain('[Prisoner C-Scores]');
    expect(ctx).toContain('Prisoner #1: 4 points');
    expect(ctx).toContain('Prisoner #2: -2 points');
  });

  it('guard with zero prisoners returns an empty string', () => {
    const ctx = getPointsContext(makeDeps({ getAllPrisonerPoints: () => [] }));
    expect(ctx).toBe('');
  });

  it('prisoner sees only their own C-Score', () => {
    const deps = makeDeps({
      role: 'prisoner',
      agentId: 'p1',
      getPoints: (id) => (id === 'p1' ? 7 : 99),
    });

    const ctx = getPointsContext(deps);

    expect(ctx).toBe('[Your C-Score] 7 points');
    expect(ctx).not.toContain('99');
    expect(ctx).not.toContain('Prisoner #2');
  });

  it('prisoner with a negative C-Score sees the negative value', () => {
    const deps = makeDeps({
      role: 'prisoner',
      agentId: 'p1',
      getPoints: () => -3,
    });

    expect(getPointsContext(deps)).toBe('[Your C-Score] -3 points');
  });
});
