/**
 * Serialize LLM calls until the first one succeeds.
 *
 * A serverless GPU endpoint cold-starts in ~90s and typically has only a
 * few workers. If every agent fires at once, surplus requests sit in the
 * provider queue (that wait counts against our abort timeout), abort
 * together, retry together, and never let a worker finish.
 *
 * After the first success the workers are warm and this gate is a no-op.
 */

export interface BackendWarmupGate {
  /** Wait until this caller may start an LLM request. */
  acquire: (agentId: string) => Promise<void>;
  /** Lift the gate: every waiter proceeds, later acquires are instant. */
  markSuccess: () => void;
  /**
   * Drop the exclusive slot without lifting the gate, so the next waiter
   * (or a retry) can try. No-op once already warm.
   */
  releaseWithoutSuccess: () => void;
  isWarmedUp: () => boolean;
  reset: () => void;
}

export function createBackendWarmupGate(): BackendWarmupGate {
  let warmedUp = false;
  let inFlight = false;
  let epoch = 0;
  const waiters: Array<() => void> = [];

  async function acquire(agentId: string): Promise<void> {
    for (;;) {
      const startedAt = epoch;
      if (warmedUp) return;
      if (!inFlight) {
        inFlight = true;
        return;
      }
      console.log(
        `[AI] ${agentId}: Waiting for first successful LLM call before starting`,
      );
      await new Promise<void>((resolve) => {
        waiters.push(resolve);
      });
      if (epoch !== startedAt) continue;
      return;
    }
  }

  function markSuccess(): void {
    warmedUp = true;
    inFlight = false;
    const pending = waiters.splice(0);
    for (const w of pending) w();
  }

  function releaseWithoutSuccess(): void {
    if (warmedUp) return;
    inFlight = false;
    const next = waiters.shift();
    if (next) {
      inFlight = true;
      next();
    }
  }

  function reset(): void {
    epoch += 1;
    warmedUp = false;
    inFlight = false;
    const pending = waiters.splice(0);
    for (const w of pending) w();
  }

  return {
    acquire,
    markSuccess,
    releaseWithoutSuccess,
    isWarmedUp: () => warmedUp,
    reset,
  };
}

const gate = createBackendWarmupGate();

export function acquireWarmupSlot(agentId: string): Promise<void> {
  return gate.acquire(agentId);
}

export function markBackendWarmedUp(): void {
  gate.markSuccess();
}

export function releaseWarmupSlot(): void {
  gate.releaseWithoutSuccess();
}

export function isBackendWarmedUp(): boolean {
  return gate.isWarmedUp();
}

export function resetBackendWarmup(): void {
  gate.reset();
}
