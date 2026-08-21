/**
 * Classification of LLM call failures, shared by the tick loop's error
 * handling and kept pure for unit testing.
 */

export interface LlmErrorLike {
  name?: string;
  status?: number;
  statusCode?: number;
  message?: string;
}

/**
 * A call that was aborted by our own timeout, or expired in the rate
 * limiter queue. Expected during serverless cold starts / worker stalls —
 * retry quickly and quietly, no stack trace.
 */
export function isTimeoutError(err: LlmErrorLike | undefined): boolean {
  if (!err) return false;
  if (err.name === "TimeoutError" || err.name === "AbortError") return true;
  const msg = err.message?.toLowerCase() ?? "";
  return (
    msg.includes("timed out") ||
    msg.includes("aborted") ||
    msg.includes("operation was aborted")
  );
}
