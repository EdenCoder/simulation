/**
 * Per-agent rate limiting for LLM API calls, backed by Bottleneck.
 *
 * Each agent gets its own limiter sized by role-specific QPS env vars,
 * optionally chained to a global upper-bound limiter. Configuration:
 *
 *   VITE_PRISONER_QPS  per-prisoner QPS (default 0.5)
 *   VITE_GUARD_QPS     per-guard QPS    (default 0.5)
 *   VITE_GLOBAL_QPS    upper bound across all agents (default 0 = none)
 *
 * Set any value to 0 (or leave unset) to disable that limit.
 */

import Bottleneck from "bottleneck";

function envFloat(name: string, fallback: number): number {
  const raw = import.meta.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = parseFloat(raw as string);
  return Number.isFinite(n) ? n : fallback;
}

const PRISONER_QPS = envFloat("VITE_PRISONER_QPS", 0.5);
const GUARD_QPS = envFloat("VITE_GUARD_QPS", 0.5);
const GLOBAL_QPS = envFloat("VITE_GLOBAL_QPS", 0);

/** Convert a QPS rate to Bottleneck `minTime` in ms. 0 / negative → no gap. */
function qpsToMinTime(qps: number): number {
  if (qps <= 0) return 0;
  return Math.round(1000 / qps);
}

/** Global upper-bound limiter, or null if disabled. */
const globalLimiter: Bottleneck | null =
  GLOBAL_QPS > 0
    ? new Bottleneck({ minTime: qpsToMinTime(GLOBAL_QPS) })
    : null;

const agentLimiters = new Map<string, Bottleneck>();

console.log(
  `[AI] Rate limits: prisoner=${PRISONER_QPS} QPS, guard=${GUARD_QPS} QPS, global=${
    GLOBAL_QPS > 0 ? `${GLOBAL_QPS} QPS` : "disabled"
  }`,
);

/**
 * Get (or lazily create) the Bottleneck limiter for a given agent.
 *
 * `minTime` enforces a minimum gap between scheduled jobs to give us a
 * steady QPS rate. `maxConcurrent: 1` ensures we never have two
 * in-flight requests for the same agent. When `VITE_GLOBAL_QPS` is set,
 * each per-agent limiter is `.chain()`ed to a shared global limiter so
 * the upper bound is enforced cluster-wide.
 */
function getAgentLimiter(agentId: string, role: string): Bottleneck {
  let limiter = agentLimiters.get(agentId);
  if (!limiter) {
    const qps = role === "guard" ? GUARD_QPS : PRISONER_QPS;
    limiter = new Bottleneck({
      maxConcurrent: 1,
      minTime: qpsToMinTime(qps),
    });
    if (globalLimiter) {
      limiter.chain(globalLimiter);
    }
    agentLimiters.set(agentId, limiter);
  }
  return limiter;
}

/**
 * Schedule an async function to run under the agent's rate limit. The
 * returned promise resolves with the function's return value once it
 * has been allowed to run and has completed.
 */
export function scheduleAgentCall<T>(
  agentId: string,
  role: string,
  fn: () => Promise<T>,
): Promise<T> {
  return getAgentLimiter(agentId, role).schedule(fn);
}
