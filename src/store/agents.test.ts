import { beforeEach, describe, expect, it } from 'vitest';

import { useAgentsStore, type AgentState } from '@/store/agents';

/** Build a minimal AgentState for tests. */
function makeAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 'p1',
    name: 'Prisoner #1',
    role: 'prisoner',
    characterType: 'arthur',
    x: 0,
    y: 0,
    tint: 0xffffff,
    speed: 1,
    currentEmoji: null,
    speechBubble: null,
    thoughtBubble: null,
    moveBubble: null,
    currentChatId: null,
    chatMessages: [],
    points: 0,
    ...overrides,
  };
}

describe('useAgentsStore — C-Score (points)', () => {
  beforeEach(() => {
    // Reset to a clean store of two prisoners and one guard before each test.
    useAgentsStore.getState().initAgents([
      makeAgent({ id: 'p1', name: 'Prisoner #1', role: 'prisoner' }),
      makeAgent({ id: 'p2', name: 'Prisoner #2', role: 'prisoner' }),
      makeAgent({ id: 'g1', name: 'Guard #1', role: 'guard' }),
    ]);
  });

  it('initializes every agent at 0 points', () => {
    const store = useAgentsStore.getState();
    expect(store.getPoints('p1')).toBe(0);
    expect(store.getPoints('p2')).toBe(0);
    expect(store.getPoints('g1')).toBe(0);
  });

  it('returns 0 for an unknown agent id', () => {
    expect(useAgentsStore.getState().getPoints('does-not-exist')).toBe(0);
  });

  it('addPoints increments the targeted agent only', () => {
    const store = useAgentsStore.getState();
    store.addPoints('p1', 3);

    expect(useAgentsStore.getState().getPoints('p1')).toBe(3);
    expect(useAgentsStore.getState().getPoints('p2')).toBe(0);
  });

  it('addPoints accumulates across multiple calls', () => {
    const store = useAgentsStore.getState();
    store.addPoints('p1', 2);
    store.addPoints('p1', 5);

    expect(useAgentsStore.getState().getPoints('p1')).toBe(7);
  });

  it('subtractPoints decrements the targeted agent', () => {
    const store = useAgentsStore.getState();
    store.addPoints('p1', 5);
    store.subtractPoints('p1', 2);

    expect(useAgentsStore.getState().getPoints('p1')).toBe(3);
  });

  it('subtractPoints allows the score to go negative (regression: no Math.max clamp)', () => {
    // This is the bug-fix the test guards: previously subtractPoints clamped at 0,
    // so deducting from a 0-score prisoner was a silent no-op.
    const store = useAgentsStore.getState();
    store.subtractPoints('p1', 1);

    expect(useAgentsStore.getState().getPoints('p1')).toBe(-1);
  });

  it('subtractPoints can drive scores well below zero', () => {
    const store = useAgentsStore.getState();
    store.subtractPoints('p1', 5);
    store.subtractPoints('p1', 3);

    expect(useAgentsStore.getState().getPoints('p1')).toBe(-8);
  });

  it('getAllPrisonerPoints returns only prisoners with their current points', () => {
    const store = useAgentsStore.getState();
    store.addPoints('p1', 4);
    store.subtractPoints('p2', 2);

    const all = useAgentsStore.getState().getAllPrisonerPoints();

    expect(all).toHaveLength(2);
    expect(all).toEqual(
      expect.arrayContaining([
        { id: 'p1', name: 'Prisoner #1', points: 4 },
        { id: 'p2', name: 'Prisoner #2', points: -2 },
      ]),
    );
    // Guard is excluded
    expect(all.find((a) => a.id === 'g1')).toBeUndefined();
  });

  it('point mutations do not corrupt unrelated agent fields', () => {
    const store = useAgentsStore.getState();
    store.addPoints('p1', 5);

    const p1 = useAgentsStore.getState().getAgent('p1');
    expect(p1?.name).toBe('Prisoner #1');
    expect(p1?.role).toBe('prisoner');
    expect(p1?.x).toBe(0);
    expect(p1?.y).toBe(0);
  });
});
