/**
 * Simulation time context. Runs at 2x realtime.
 * The simulation starts at 6:00 PM (the beginning of "lights on").
 */

let startTime: number | null = null;

// The simulation begins at 6:00 PM on the first day
const SIM_START_HOUR = 18; // 6:00 PM

/** Call once when the simulation starts. */
export function initSimulationTime(): void {
  if (startTime === null) {
    startTime = Date.now();
  }
}

/** Get the current in-simulation time, or null if not started. */
export function getCurrentGameTime(): Date | null {
  if (startTime === null) return null;
  const elapsed = Date.now() - startTime;
  const simElapsed = elapsed * 2; // 2x realtime

  // Start at 6:00 PM today
  const simTime = new Date();
  simTime.setHours(SIM_START_HOUR, 0, 0, 0);
  return new Date(simTime.getTime() + simElapsed);
}

/** Build a system prompt section describing the current time. Unambiguous 24h + 12h format. */
export function getTimeContext(): string {
  const time = getCurrentGameTime();
  if (!time) return '';

  const hours = time.getHours();
  const minutes = time.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h12 = hours % 12 || 12;

  return `[Current Simulation Time] ${h12}:${minutes} ${ampm} (${hours.toString().padStart(2, '0')}:${minutes} 24h format)`;
}
